const { randomUUID } = require('node:crypto');
const { OrganizationError } = require('./organizer');

const COLUMNS = `id, version, name, scope, include_children AS includeChildren, keyword, extension, tag,
                 minimum_rating AS minimumRating`;

class SmartFolders {
  constructor(db, writable) {
    if (writable) {
      db.exec(`CREATE TABLE IF NOT EXISTS smart_folders (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL DEFAULT 1,
        name TEXT COLLATE NOCASE NOT NULL UNIQUE,
        scope TEXT REFERENCES folders(id),
        include_children INTEGER NOT NULL,
        keyword TEXT NOT NULL,
        extension TEXT NOT NULL,
        tag TEXT NOT NULL,
        minimum_rating INTEGER NOT NULL CHECK (minimum_rating BETWEEN 0 AND 5)
      );`);
    }
    this.get = db.prepare(`SELECT ${COLUMNS} FROM smart_folders WHERE id = ?`);
    this.all = db.prepare(`SELECT ${COLUMNS} FROM smart_folders ORDER BY name, id`);
    if (!writable) return;

    this.findScope = db.prepare('SELECT 1 FROM folders WHERE id = ?');
    this.insert = db.prepare(`INSERT INTO smart_folders
      (id, name, scope, include_children, keyword, extension, tag, minimum_rating) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    this.update = db.prepare(`UPDATE smart_folders SET name = ?, scope = ?, include_children = ?, keyword = ?,
      extension = ?, tag = ?, minimum_rating = ?, version = version + 1 WHERE id = ? AND version = ?`);
    this.remove = db.prepare('DELETE FROM smart_folders WHERE id = ? AND version = ?');
  }

  list() {
    return this.all.all();
  }

  read(id) {
    return this.get.get(id);
  }

  save({ id, version, name, scope, includeChildren, keyword, extension, tag, minimumRating } = {}) {
    const cleanedName = readText(name, 60, '名称');
    const cleanedKeyword = readText(keyword, 160, '关键词');
    const cleanedExt = readText(extension, 16, '格式').replace(/^\./, '').toLowerCase();
    const cleanedTag = readText(tag, 80, '标签');
    if (!cleanedName) throw new OrganizationError('请输入智能文件夹名称。');
    if (scope != null && (typeof scope !== 'string' || !this.findScope.get(scope))) {
      throw new OrganizationError('请选择库里已有的文件夹作为范围。');
    }
    if (cleanedExt && !/^[a-z0-9][a-z0-9+-]*$/.test(cleanedExt)) throw new OrganizationError('请输入文件扩展名，例如 mp3。');
    if (!Number.isInteger(minimumRating) || minimumRating < 0 || minimumRating > 5) {
      throw new OrganizationError('最低评分应在 0 到 5 之间。');
    }
    const values = [cleanedName, scope ?? null, Number(Boolean(scope) && includeChildren === true),
      cleanedKeyword, cleanedExt, cleanedTag, minimumRating];
    try {
      if (id == null) {
        id = `smart:${randomUUID()}`;
        this.insert.run(id, ...values);
      } else {
        assertRevision(id, version);
        if (!this.update.run(...values, id, version).changes) throw revisionConflict();
      }
    } catch (error) {
      if (error.errcode === 2067) throw new OrganizationError('已有同名智能文件夹。', 409);
      throw error;
    }
    return this.read(id);
  }

  removeRule({ id, version } = {}) {
    assertRevision(id, version);
    if (!this.remove.run(id, version).changes) throw revisionConflict();
    return { id };
  }
}

function readText(value, max, field) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.trim().length > max) {
    throw new OrganizationError(`${field}最多 ${max} 个字符。`);
  }
  return value.trim();
}

function assertRevision(id, version) {
  if (typeof id !== 'string' || !/^smart:[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(version) || version < 1) {
    throw new OrganizationError('智能文件夹记录无效。');
  }
}

function revisionConflict() {
  return new OrganizationError('这条规则已被修改。请刷新页面后重试。', 409);
}

module.exports = SmartFolders;
