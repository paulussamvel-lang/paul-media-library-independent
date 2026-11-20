const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { OrganizationError } = require('./organizer');
const { assetDirectory } = require('./storage');

const CAPTURE_ID = /^capture-[a-f0-9]{32}$/;
const sha = (value) => createHash('sha256').update(value).digest('hex');

function isFilename(value) {
  return typeof value === 'string' && value === path.basename(value) && !/^[.]|[\\/\x00]/.test(value);
}

function writeAtomically(directory, name, bytes) {
  const temporary = path.join(directory, '.import-part');
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, path.join(directory, name));
}

function copyAtomically(source, directory, name) {
  const temporary = path.join(directory, '.import-part');
  fs.copyFileSync(source, temporary, fs.constants.COPYFILE_FICLONE);
  fs.renameSync(temporary, path.join(directory, name));
}

function fileMatches(filename, size, expected) {
  if (!fs.existsSync(filename) || fs.statSync(filename).size !== size) return false;
  const fd = fs.openSync(filename, 'r');
  const buffer = Buffer.allocUnsafe(256 * 1024);
  const hash = createHash('sha256');
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
    return hash.digest('hex') === expected;
  } finally {
    fs.closeSync(fd);
  }
}

class IngestStore {
  constructor(db, library) {
    this.db = db;
    this.library = library;
    this.staging = path.join(library, 'captures', '.pending');
    db.exec(`CREATE TABLE IF NOT EXISTS capture_receipts (
      request_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), request_hash TEXT NOT NULL, reused INTEGER NOT NULL
    ); CREATE TABLE IF NOT EXISTS asset_sources (
      asset_id TEXT NOT NULL REFERENCES assets(id), url TEXT NOT NULL, PRIMARY KEY(asset_id,url)
    );`);
    this.asset = db.prepare('SELECT id,name,sha256,source_url FROM assets WHERE id=?');
    this.byHash = db.prepare('SELECT id,name,original_name,source_url FROM assets WHERE sha256=? ORDER BY btime,id');
    this.receipt = db.prepare('SELECT asset_id,request_hash,reused FROM capture_receipts WHERE request_id=?');
    this.saveReceipt = db.prepare('INSERT INTO capture_receipts VALUES (?,?,?,?)');
    this.addAsset = db.prepare(`INSERT INTO assets (id,name,ext,width,height,btime,source_url,original_name,
      thumbnail_name,byte_size,sha256,source_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.addTag = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id,tag) VALUES (?,?)');
    this.addFolder = db.prepare('INSERT OR IGNORE INTO asset_folders (asset_id,folder_id) VALUES (?,?)');
    this.addSource = db.prepare('INSERT OR IGNORE INTO asset_sources VALUES (?,?)');
  }

  save(record, bytes, preview) {
    const result = this.transaction(() => {
      const saved = this.existingReceipt(record);
      if (saved) return saved;
      const pending = this.readPending(record.id);
      if (pending && pending.requestHash !== record.requestHash) throw this.conflict();
      const directory = this.stage(record.id);
      if (!pending) {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        writeAtomically(directory, 'original', bytes);
        if (preview) writeAtomically(directory, 'thumbnail', preview);
        // Only a completed manifest makes a staging directory eligible for recovery.
        writeAtomically(directory, 'manifest.json', JSON.stringify(record));
      }
      return this.publish(pending || record);
    });
    this.clean(record.id);
    return result;
  }

  saveUploaded(record, uploaded) {
    const result = this.transaction(() => {
      const saved = this.existingReceipt(record);
      if (saved) return saved;
      const pending = this.readPending(record.id);
      if (pending) {
        if (pending.requestHash !== record.requestHash) throw this.conflict();
        return this.publish(pending);
      }
      const directory = this.stage(record.id);
      fs.renameSync(uploaded, path.join(directory, 'original'));
      writeAtomically(directory, 'manifest.json', JSON.stringify(record));
      return this.publish(record, true);
    });
    this.clean(record.id);
    return result;
  }

  stage(id) {
    if (!CAPTURE_ID.test(id)) throw new Error('Invalid staged asset ID');
    return path.join(this.staging, id);
  }

  readPending(id) {
    const manifest = path.join(this.stage(id), 'manifest.json');
    if (!fs.existsSync(manifest)) return null;
    const record = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (record.id !== id || `capture-${record.requestId?.replaceAll('-', '')}` !== id ||
        !isFilename(record.originalName) || (record.thumbnailName && !isFilename(record.thumbnailName))) {
      throw new Error('Invalid staging manifest');
    }
    return record;
  }

  conflict() {
    return new OrganizationError('这次导入的内容已变化，请重新选择素材。', 409);
  }

  existingReceipt(record) {
    const receipt = this.receipt.get(record.requestId);
    if (receipt) {
      if (receipt.request_hash !== record.requestHash) throw this.conflict();
      return this.result(this.asset.get(receipt.asset_id), record, true, Boolean(receipt.reused));
    }
    const legacy = this.asset.get(record.id);
    if (!legacy) return null;
    if (legacy.sha256 !== record.hash || legacy.source_url !== record.origin) throw this.conflict();
    return this.result(legacy, record, true, false);
  }

  result(asset, record, alreadySaved, reused) {
    return { id: asset.id, name: asset.name, sourceUrl: record.origin, alreadySaved, reused };
  }

  publish(record, verified = false) {
    const stage = this.stage(record.id);
    const originalFile = path.join(stage, 'original');
    if (!verified && !fileMatches(originalFile, record.byteSize, record.hash)) throw new Error('暂存原件校验失败');
    const original = this.byHash.all(record.hash).find((asset) => {
      if (!/^[a-z0-9_-]+$/i.test(asset.id) || !isFilename(asset.original_name)) return false;
      const filename = path.join(assetDirectory(this.library, asset.id), asset.original_name);
      return fileMatches(filename, record.byteSize, record.hash);
    });
    const assetId = original?.id || record.id;

    if (!original) {
      const directory = assetDirectory(this.library, assetId);
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      copyAtomically(originalFile, directory, record.originalName);
      if (record.thumbnailName && record.thumbnailName !== record.originalName) {
        writeAtomically(directory, record.thumbnailName, fs.readFileSync(path.join(stage, 'thumbnail')));
      }
      this.addAsset.run(assetId, record.title, record.ext, record.width, record.height, Date.now(), record.origin,
        record.originalName, record.thumbnailName, record.byteSize, record.hash, JSON.stringify({ importedBy: record.source }));
    }
    if (original?.source_url) this.addSource.run(assetId, original.source_url);
    if (record.origin) this.addSource.run(assetId, record.origin);
    if (record.folderId) this.addFolder.run(assetId, record.folderId);
    for (const tag of record.tags) this.addTag.run(assetId, tag);
    this.saveReceipt.run(record.requestId, assetId, record.requestHash, Number(Boolean(original)));
    return this.result({ id: assetId, name: original?.name || record.title }, record, false, Boolean(original));
  }

  recover() {
    if (!fs.existsSync(this.staging)) return;
    for (const entry of fs.readdirSync(this.staging, { withFileTypes: true })) {
      if (!entry.isDirectory() || !CAPTURE_ID.test(entry.name)) continue;
      try {
        fs.rmSync(path.join(this.stage(entry.name), 'stream-upload'), { force: true });
        const repaired = this.transaction(() => {
          const record = this.readPending(entry.name);
          return record && (this.existingReceipt(record) || this.publish(record));
        });
        if (repaired) this.clean(entry.name);
      } catch (error) {
        console.error(`保留未完成的导入 ${entry.name}：${error.code || error.message}`);
      }
    }
  }

  clean(id) {
    try { fs.rmSync(this.stage(id), { recursive: true, force: true }); }
    catch (error) { console.error(`无法清理已完成的导入 ${id}：${error.code}`); }
  }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

module.exports = { IngestStore, sha };
