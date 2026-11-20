class OrganizationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
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
    `);
    this.findAsset = db.prepare('SELECT 1 FROM assets WHERE id = ?');
    this.findFolder = db.prepare('SELECT 1 FROM folders WHERE id = ?');
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

  apply({ action, ids, tags, folderId } = {}) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10000 ||
        ids.some((id) => typeof id !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(id))) {
      throw new OrganizationError('请选择有效的素材。');
    }

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
      for (const id of new Set(ids)) {
        if (!this.findAsset.get(id)) throw new OrganizationError('部分素材已不存在。刷新列表后重试。', 409);
        const before = links.read.all(id).map((row) => row.value);
        const replacing = action === 'move-to-folder';
        const toAdd = replacing ? additions : additions.filter((value) => !before.includes(value));
        if (!toAdd.length || (replacing && before.length === 1 && before[0] === folderId)) continue;

        if (replacing) links.clear.run(id);
        for (const value of toAdd) links.add.run(id, value);
        changed.push({ id, before });
      }
      if (changed.length) this.save.run(kind, JSON.stringify(changed));
      return { updated: changed.length, latestEdit: this.latestEdit() };
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
        links.clear.run(id);
        for (const value of before) links.add.run(id, value);
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
