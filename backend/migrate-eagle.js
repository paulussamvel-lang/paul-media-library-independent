const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function fileHash(filename) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filename);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function copyVerified(source, destination) {
  const before = fs.lstatSync(source);
  if (!before.isFile()) throw new Error(`预期是本地文件：${source}`);
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
  const [original, copy] = await Promise.all([fileHash(source), fileHash(destination)]);
  const after = fs.statSync(source);
  if (original !== copy || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error(`复制校验失败：${source}`);
  }
  return { sha256: copy, byteSize: before.size };
}

function itemFilename(name, extension) {
  const filename = `${name}.${extension}`;
  if (filename === path.basename(filename) && !filename.includes('\\')) return filename;
  throw new Error('素材文件名无效');
}

function saveFolders(insert, folders, parent = null) {
  folders.forEach((folder, position) => {
    insert.run(folder.id, parent, folder.name, position);
    saveFolders(insert, folder.children || [], folder.id);
  });
}

function snapshotSource(source) {
  const ids = fs.readdirSync(path.join(source, 'images'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.info'))
    .map((entry) => entry.name).sort();
  const metadata = fs.readFileSync(path.join(source, 'metadata.json'), 'utf8');
  const hash = createHash('sha256').update(metadata);
  const items = ids.map((id) => {
    const directory = path.join(source, 'images', id);
    const metaPath = path.join(directory, 'metadata.json');
    const json = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf8') : null;
    hash.update(id).update(json ?? '<missing metadata>');
    return { directory, json, record: json === null ? null : JSON.parse(json) };
  });
  return { metadata, items, sha256: hash.digest('hex') };
}

async function migrate(sourceArg, targetArg) {
  if (!sourceArg || !targetArg) throw new Error('用法：migrate-eagle.js <Eagle .library> <新库目录>');
  const source = fs.realpathSync(sourceArg);
  const target = path.resolve(targetArg);
  const targetParent = fs.realpathSync(path.dirname(target));
  if (targetParent === source || targetParent.startsWith(`${source}${path.sep}`)) {
    throw new Error('请把新库放在 Eagle 库以外');
  }
  if (fs.existsSync(target)) throw new Error(`目标目录已存在：${target}`);
  const snapshot = snapshotSource(source);
  const staging = fs.mkdtempSync(path.join(targetParent, '.paul-library-migration-'));
  const assetsRoot = path.join(staging, 'files');
  fs.mkdirSync(assetsRoot);

  const db = new DatabaseSync(path.join(staging, 'library.sqlite'));
  let assets = 0;
  let thumbnails = 0;
  let bytes = 0;
  let unindexed = 0;
  try {
    db.exec(fs.readFileSync(path.join(__dirname, 'library-schema.sql'), 'utf8'));
    db.exec('BEGIN');
    db.prepare('INSERT INTO library VALUES (1, ?)').run(snapshot.metadata);
    saveFolders(db.prepare('INSERT INTO folders VALUES (?, ?, ?, ?)'), JSON.parse(snapshot.metadata).folders);
    const addAsset = db.prepare('INSERT INTO assets VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const addFolder = db.prepare('INSERT INTO asset_folders VALUES (?, ?)');
    const addTag = db.prepare('INSERT INTO asset_tags VALUES (?, ?)');

    for (const { directory, json, record } of snapshot.items) {
      if (record === null) {
        const destination = path.join(staging, 'unindexed', path.basename(directory));
        fs.mkdirSync(destination, { recursive: true });
        for (const file of fs.readdirSync(directory)) {
          await copyVerified(path.join(directory, file), path.join(destination, file));
        }
        unindexed++;
        continue;
      }
      if (record.deleted || record.isDeleted) continue;
      const { id, name, ext } = record;
      if (!/^[a-z0-9_-]+$/i.test(id) || path.basename(directory) !== `${id}.info` || !name || !ext) {
        throw new Error(`素材元数据无效：${directory}`);
      }

      const destination = path.join(assetsRoot, id);
      fs.mkdirSync(destination);
      const originalName = itemFilename(name, ext);
      const original = await copyVerified(path.join(directory, originalName), path.join(destination, originalName));
      const thumbnailName = itemFilename(`${name}_thumbnail`, 'png');
      const thumbnailPath = path.join(directory, thumbnailName);
      const hasThumbnail = fs.existsSync(thumbnailPath);
      if (hasThumbnail) {
        await copyVerified(thumbnailPath, path.join(destination, thumbnailName));
        thumbnails++;
      }

      addAsset.run(id, name, ext, record.width ?? null, record.height ?? null, record.btime ?? null,
        record.star ?? record.rating ?? null, record.annotation ?? null, record.url ?? null,
        originalName, hasThumbnail ? thumbnailName : null, original.byteSize, original.sha256, json);
      for (const folder of new Set(record.folders || [])) addFolder.run(id, folder);
      for (const tag of new Set(record.tags || [])) addTag.run(id, tag);
      assets++;
      bytes += original.byteSize;
      if (assets % 400 === 0) console.log(`已校验 ${assets} 个原文件`);
    }

    if (snapshotSource(source).sha256 !== snapshot.sha256) throw new Error('源库在迁移期间发生变化');
    db.exec('COMMIT');
    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (integrity.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('新库数据库完整性检查失败');
    }
  } catch (error) {
    console.error(`迁移未发布。临时目录：${staging}`);
    throw error;
  } finally {
    db.close();
  }

  if (fs.existsSync(target)) throw new Error(`目标目录已存在：${target}`);
  fs.renameSync(staging, target);
  console.log(JSON.stringify({ target, assets, thumbnails, bytes, unindexed }));
}

migrate(...process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
