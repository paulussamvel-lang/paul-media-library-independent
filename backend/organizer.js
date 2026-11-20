const { randomUUID } = require('node:crypto');

class OrganizationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function cleanName(value, label) {
  const name = typeof value === 'string' ? value.trim().normalize('NFC') : '';
  if (!name || name.length > 160 || /[\\/:\x00-\x1f\x7f]/.test(name) || name === '.' || name === '..') {
    throw new OrganizationError(`${label}须为 1–160 个字符，且不能包含斜杠、冒号或控制字符。`);
  }
  return name;
}

const nameKey = name => name.normalize('NFC').trim().toLowerCase();

function nameParts(name, extension) {
  const suffix = extension && name.toLowerCase().endsWith('.' + extension.toLowerCase()) ?
    name.slice(-extension.length - 1) : '';
  return { base: suffix ? name.slice(0, -suffix.length) : name, suffix };
}

function assetNameKey(folder, name, extension) {
  return JSON.stringify([folder, extension.toLowerCase(), nameKey(nameParts(name, extension).base)]);
}

class Organizer {
  constructor(db) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS organization_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        snapshot TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trashed_assets (
        asset_id TEXT PRIMARY KEY NOT NULL REFERENCES assets(id),
        trashed_at INTEGER NOT NULL
      );
    `);
    this.findAsset = db.prepare(`SELECT a.name, a.ext, t.trashed_at AS trashedAt FROM assets a
      LEFT JOIN trashed_assets t ON t.asset_id = a.id WHERE a.id = ?`);
    this.findFolder = db.prepare('SELECT id, parent_id, name FROM folders WHERE id = ?');
    this.siblings = db.prepare('SELECT id, name, position FROM folders WHERE parent_id IS ?');
    this.addFolder = db.prepare('INSERT INTO folders (id, parent_id, name, position) VALUES (?, ?, ?, ?)');
    this.renameFolder = db.prepare('UPDATE folders SET name = ? WHERE id = ?');
    this.activeNames = db.prepare(`SELECT a.id, a.name, a.ext, af.folder_id AS folder
      FROM assets a LEFT JOIN asset_folders af ON a.id = af.asset_id
      WHERE NOT EXISTS (SELECT 1 FROM trashed_assets t WHERE t.asset_id = a.id)`);
    this.renameAsset = db.prepare('UPDATE assets SET name = ? WHERE id = ?');
    this.trashAsset = db.prepare('INSERT INTO trashed_assets (asset_id, trashed_at) VALUES (?, ?)');
    this.restoreAsset = db.prepare('DELETE FROM trashed_assets WHERE asset_id = ?');
    this.save = db.prepare('INSERT INTO organization_history (kind, snapshot) VALUES (?, ?)');
    this.latest = db.prepare('SELECT id, kind, snapshot FROM organization_history ORDER BY id DESC LIMIT 1');
    this.remove = db.prepare('DELETE FROM organization_history WHERE id = ?');
    this.links = {
      tags: this.linkStatements('asset_tags', 'tag'),
      folders: this.linkStatements('asset_folders', 'folder_id'),
    };
  }

  linkStatements(table, column) {
    return {
      read: this.db.prepare(`SELECT ${column} AS value FROM ${table} WHERE asset_id = ? ORDER BY ${column}`),
      clear: this.db.prepare(`DELETE FROM ${table} WHERE asset_id = ?`),
      add: this.db.prepare(`INSERT INTO ${table} (asset_id, ${column}) VALUES (?, ?)`),
    };
  }

  latestEdit() {
    const edit = this.latest.get();
    return edit ? { id: edit.id } : null;
  }

  saveFolder({ id = null, parentId = null, name } = {}) {
    const title = cleanName(name, '文件夹名称');
    if ((id !== null && typeof id !== 'string') || (parentId !== null && typeof parentId !== 'string')) {
      throw new OrganizationError('文件夹无效。');
    }
    return this.transaction(() => {
      const current = id === null ? null : this.findFolder.get(id);
      if (id !== null && !current) throw new OrganizationError('文件夹已不存在。', 409);
      const parent = current ? current.parent_id : parentId;
      if (parent !== null && !this.findFolder.get(parent)) throw new OrganizationError('上级文件夹已不存在。', 409);
      const siblings = this.siblings.all(parent);
      if (siblings.some(folder => folder.id !== id && nameKey(folder.name) === nameKey(title))) {
        throw new OrganizationError('同一级已经有这个名称的文件夹。', 409);
      }
      if (current) {
        this.renameFolder.run(title, id);
        return id;
      }
      const created = randomUUID();
      const position = siblings.reduce((last, folder) => Math.max(last, folder.position), -1) + 1;
      this.addFolder.run(created, parent, title, position);
      return created;
    });
  }

  apply({ action, ids, tags, folderId, renameMode, pattern, replacement } = {}) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10000 ||
        ids.some((id) => typeof id !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(id))) {
      throw new OrganizationError('请选择有效的素材。');
    }

    const uniqueIds = [...new Set(ids)];
    if (action === 'rename') return this.renameMany(uniqueIds, renameMode, pattern, replacement);
    if (action === 'trash' || action === 'restore') return this.changeTrash(uniqueIds, action === 'trash');

    const isTagging = action === 'add-tags';
    if (!isTagging && action !== 'add-to-folder' && action !== 'move-to-folder') {
      throw new OrganizationError('请选择整理操作。');
    }
    if (isTagging && (!Array.isArray(tags) || tags.length < 1 || tags.length > 30 ||
        tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 80))) {
      throw new OrganizationError('请输入 1–30 个标签，每个最多 80 个字符。');
    }
    if (!isTagging && (typeof folderId !== 'string' || !this.findFolder.get(folderId))) {
      throw new OrganizationError('请选择库里已有的文件夹。');
    }

    const additions = isTagging ? [...new Set(tags.map((tag) => tag.trim()))] : [folderId];
    const kind = isTagging ? 'tags' : 'folders';
    const links = this.links[kind];
    return this.transaction(() => {
      const changed = [];
      for (const id of uniqueIds) {
        this.requireActive(id);
        const before = links.read.all(id).map((row) => row.value);
        const replacing = action === 'move-to-folder';
        const toAdd = replacing ? additions : additions.filter((value) => !before.includes(value));
        if (!toAdd.length || (replacing && before.length === 1 && before[0] === folderId)) continue;

        if (replacing) links.clear.run(id);
        for (const value of toAdd) links.add.run(id, value);
        changed.push({ id, before });
      }
      return this.record(kind, changed);
    });
  }

  requireActive(id) {
    const asset = this.findAsset.get(id);
    if (!asset || asset.trashedAt !== null) {
      throw new OrganizationError('部分素材已不在当前图库。刷新列表后重试。', 409);
    }
    return asset;
  }

  record(kind, snapshot) {
    if (snapshot.length) this.save.run(kind, JSON.stringify(snapshot));
    return { updated: snapshot.length, latestEdit: this.latestEdit() };
  }

  renameMany(ids, mode, pattern, replacement) {
    const numbered = mode === 'sequence';
    if (numbered) {
      pattern = cleanName(pattern, '新名称');
    } else if (mode !== 'replace' || typeof pattern !== 'string' || !pattern.trim() || pattern.length > 160 ||
        typeof replacement !== 'string' || replacement.length > 160) {
      throw new OrganizationError('请输入有效的查找和替换内容。');
    }
    return this.transaction(() => {
      const plan = new Map();
      const digits = Math.max(3, String(ids.length).length);
      for (const [index, id] of ids.entries()) {
        const asset = this.requireActive(id);
        const { base, suffix } = nameParts(asset.name, asset.ext);
        if (!numbered && !base.includes(pattern)) continue;
        const after = numbered ?
          pattern + (ids.length === 1 ? '' : '-' + String(index + 1).padStart(digits, '0')) :
          base.replaceAll(pattern, () => replacement);
        const name = cleanName(cleanName(after, '新素材名称') + suffix, '新素材名称');
        if (name !== asset.name) plan.set(id, { id, name, before: asset.name });
      }
      if (plan.size) this.checkNameConflicts(plan);
      for (const { id, name } of plan.values()) this.renameAsset.run(name, id);
      return this.record('names', [...plan.values()].map(({ id, before }) => ({ id, before })));
    });
  }

  checkNameConflicts(plan) {
    const occupied = new Set();
    const changed = [];
    for (const row of this.activeNames.iterate()) {
      const rename = plan.get(row.id);
      if (rename) changed.push({ key: assetNameKey(row.folder, rename.name, row.ext), name: rename.name });
      else occupied.add(assetNameKey(row.folder, row.name, row.ext));
    }
    for (const { key, name } of changed) {
      if (occupied.has(key)) throw new OrganizationError(`同一文件夹已有同名、同格式的素材「${name}」。`, 409);
      occupied.add(key);
    }
  }

  changeTrash(ids, trash) {
    return this.transaction(() => {
      const snapshot = [];
      const now = Date.now();
      for (const id of ids) {
        const asset = this.findAsset.get(id);
        if (!asset) throw new OrganizationError('部分素材已不存在。刷新列表后重试。', 409);
        if ((asset.trashedAt !== null) === trash) continue;
        if (trash) this.trashAsset.run(id, now);
        else this.restoreAsset.run(id);
        snapshot.push({ id, before: asset.trashedAt });
      }
      return this.record('trash', snapshot);
    });
  }

  undo({ editId } = {}) {
    if (!Number.isSafeInteger(editId) || editId < 1) throw new OrganizationError('没有可撤销的整理操作。');
    return this.transaction(() => {
      const edit = this.latest.get();
      if (edit?.id !== editId) throw new OrganizationError('整理记录已变化，请重新载入后再试。', 409);
      const links = this.links[edit.kind];
      const snapshot = JSON.parse(edit.snapshot);
      for (const { id, before } of snapshot) {
        if (edit.kind === 'names') {
          this.renameAsset.run(before, id);
        } else if (edit.kind === 'trash') {
          if (before === null) this.restoreAsset.run(id);
          else this.trashAsset.run(id, before);
        } else {
          links.clear.run(id);
          for (const value of before) links.add.run(id, value);
        }
      }
      this.remove.run(edit.id);
      return { updated: snapshot.length, latestEdit: this.latestEdit() };
    });
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

module.exports = { Organizer, OrganizationError };
