const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Organizer } = require('../organizer');
const SmartFolders = require('../smart-folders');
const { CaptureStore } = require('../capture');
const DuplicateStore = require('../duplicates');
const { assetDirectory } = require('../storage');

class ManagedProvider {
  constructor(libraryPath, writable = false) {
    this.libraryPath = libraryPath;
    this.db = new DatabaseSync(path.join(libraryPath, 'library.sqlite'), { readOnly: !writable });
    if (this.db.prepare('PRAGMA user_version').get().user_version !== 1) {
      throw new Error('素材库数据库版本不受支持');
    }
    if (writable) {
      this.db.exec('PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON;');
      this.organizer = new Organizer(this.db);
      this.captures = new CaptureStore(this.db, libraryPath);
      this.duplicates = new DuplicateStore(this.db);
    }
    if (writable || this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'smart_folders'").get()) {
      this.smartFolders = new SmartFolders(this.db, writable);
    }
    const hasSources = this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'asset_sources'").get();
    const sourcesColumn = hasSources ? `(SELECT json_group_array(url) FROM asset_sources WHERE asset_id = a.id)` : "'[]'";
    const hasTrash = this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'trashed_assets'").get();
    const trashedAt = hasTrash ? 't.trashed_at' : 'NULL';
    this.listFiles = this.db.prepare(`
      WITH RECURSIVE options(folder_id, include_children, extension, tag, minimum_rating) AS (SELECT ?, ?, ?, lower(?), ?),
      needles(needle) AS (SELECT lower(?) UNION SELECT lower(?)),
      selected(id) AS (
        SELECT id FROM folders WHERE id = (SELECT folder_id FROM options)
        UNION ALL
        SELECT f.id FROM folders f JOIN selected s ON f.parent_id = s.id
        WHERE (SELECT include_children FROM options) = 1
      )
      SELECT a.id, a.name, a.ext, a.width, a.height, a.btime, a.source_url AS sourceUrl, ${sourcesColumn} AS sourceUrls,
             a.thumbnail_name IS NOT NULL AS hasThumbnail,
             CASE WHEN a.ext IN ('mp3','m4a','aac','wav','ogg','oga','opus','flac','aif','aiff') AND json_valid(a.source_json)
                  THEN json_extract(a.source_json, '$.duration') END AS duration,
             CASE WHEN a.ext IN ('mp3','m4a','aac','wav','ogg','oga','opus','flac','aif','aiff') AND json_valid(a.source_json)
                  THEN json_extract(a.source_json, '$.bpm') END AS bpm,
             (SELECT json_group_array(t.tag) FROM asset_tags t WHERE t.asset_id = a.id) AS tags
      FROM assets a
      ${hasTrash ? 'LEFT JOIN trashed_assets t ON a.id = t.asset_id' : ''}
      CROSS JOIN options o
      WHERE ((o.folder_id = '__trash__' AND ${trashedAt} IS NOT NULL) OR
        (${trashedAt} IS NULL AND (o.folder_id = '__all__' OR a.id IN (
        SELECT af.asset_id FROM asset_folders af JOIN selected s ON af.folder_id = s.id
      ))))
      AND (o.extension = '' OR lower(a.ext) = o.extension)
      AND (o.minimum_rating = 0 OR coalesce(a.rating, 0) >= o.minimum_rating)
      AND (o.tag = '' OR EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND lower(t.tag) = o.tag))
      AND NOT EXISTS (
        SELECT 1 FROM needles n WHERE n.needle <> '' AND instr(lower(a.name), n.needle) = 0
          AND instr(lower(coalesce(a.notes, '')), n.needle) = 0
          AND NOT EXISTS (SELECT 1 FROM asset_tags t WHERE t.asset_id = a.id AND instr(lower(t.tag), n.needle) > 0)
      )
      ORDER BY coalesce(${trashedAt}, a.btime) DESC, a.id
    `);
    this.getFile = this.db.prepare('SELECT original_name, thumbnail_name FROM assets WHERE id = ?');
  }

  getFolders() {
    const rows = this.db.prepare('SELECT id, parent_id, name FROM folders ORDER BY position, id').all();
    const nodes = new Map(rows.map(({ id, name }) => [id, { id, name, children: [] }]));
    const roots = [];
    for (const { id, parent_id: parent } of rows) {
      const siblings = parent === null ? roots : nodes.get(parent).children;
      siblings.push(nodes.get(id));
    }
    return [{ id: '__all__', name: '全部素材' }, ...roots];
  }

  getImages(folderId, includeSubfolders, query = '') {
    const rule = folderId.startsWith('smart:') ? this.smartFolders?.read(folderId) : null;
    if (folderId.startsWith('smart:') && !rule) return [];
    const scope = rule ? rule.scope || '__all__' : folderId;
    return this.listFiles.all(scope, Number(rule ? rule.includeChildren : includeSubfolders),
      rule?.extension || '', rule?.tag || '', rule?.minimumRating || 0, rule?.keyword || '', query).map((asset) => ({
      ...asset,
      tags: JSON.parse(asset.tags),
      sourceUrls: [...new Set([asset.sourceUrl, ...JSON.parse(asset.sourceUrls)])].filter(Boolean),
    }));
  }

  pipeFile(id, type, response) {
    if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('Invalid asset ID');
    const asset = this.getFile.get(id);
    const name = type === 'original' ? asset?.original_name : asset?.thumbnail_name;
    if (!name || name !== path.basename(name) || name.includes('\\')) throw new Error('File not found');
    response.sendFile(name, { root: assetDirectory(this.libraryPath, id) });
  }
}

module.exports = ManagedProvider;
