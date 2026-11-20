const { OrganizationError } = require('./organizer');

const IMAGE_TYPES = "'jpg','jpeg','jfif','png','webp','gif','avif','bmp','ico','svg'";
const SIMILAR_LIMIT = 80;

class DuplicateStore {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS image_signatures (
      asset_id TEXT PRIMARY KEY REFERENCES assets(id), hash TEXT NOT NULL, ratio REAL NOT NULL,
      red INTEGER NOT NULL, green INTEGER NOT NULL, blue INTEGER NOT NULL
    ); CREATE TABLE IF NOT EXISTS ignored_similar_pairs (
      first_id TEXT NOT NULL REFERENCES assets(id), second_id TEXT NOT NULL REFERENCES assets(id),
      PRIMARY KEY(first_id,second_id)
    );`);
    this.pending = db.prepare(`SELECT a.id,a.name,a.width,a.height,a.ext,a.thumbnail_name IS NOT NULL AS hasThumbnail
      FROM assets a LEFT JOIN image_signatures s ON s.asset_id=a.id
      WHERE s.asset_id IS NULL AND lower(a.ext) IN (${IMAGE_TYPES})
        AND NOT EXISTS (SELECT 1 FROM trashed_assets t WHERE t.asset_id = a.id) ORDER BY a.id`);
    this.save = db.prepare(`INSERT OR IGNORE INTO image_signatures
      SELECT id,?,?,?,?,? FROM assets WHERE id=? AND lower(ext) IN (${IMAGE_TYPES})`);
    this.findIndexed = db.prepare('SELECT 1 FROM image_signatures WHERE asset_id=?');
    this.ignore = db.prepare('INSERT OR IGNORE INTO ignored_similar_pairs VALUES (?,?)');
  }

  index(entries) {
    if (!Array.isArray(entries) || entries.length > 100 || entries.some((s) => !s || !validSignature(s))) {
      throw new OrganizationError('图片指纹无效。');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      let count = 0;
      for (const { id, hash, ratio, red, green, blue } of entries) {
        count += this.save.run(hash, ratio, red, green, blue, id).changes;
      }
      this.db.exec('COMMIT');
      return { indexed: count };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  ignorePair({ left, right } = {}) {
    if (typeof left !== 'string' || typeof right !== 'string' || left === right ||
        !this.findIndexed.get(left) || !this.findIndexed.get(right)) {
      throw new OrganizationError('请选择已识别的相似图候选。');
    }
    this.ignore.run(...[left, right].sort());
    return { ignored: true };
  }

  report() {
    const groups = new Map();
    const exact = this.db.prepare(`WITH active AS (
      SELECT * FROM assets a WHERE NOT EXISTS (SELECT 1 FROM trashed_assets t WHERE t.asset_id = a.id)
      )
      SELECT a.id,a.name,a.ext,a.sha256,a.byte_size AS bytes
      FROM active a WHERE a.sha256 IN (SELECT sha256 FROM active GROUP BY sha256 HAVING count(*) > 1)
      ORDER BY a.sha256,a.btime,a.id`).all();
    for (const { sha256, ...asset } of exact) {
      if (!groups.has(sha256)) groups.set(sha256, []);
      groups.get(sha256).push(asset);
    }
    const indexed = this.db.prepare(`SELECT s.*,a.name,a.ext,a.sha256 FROM image_signatures s
      JOIN assets a ON a.id=s.asset_id
      WHERE NOT EXISTS (SELECT 1 FROM trashed_assets t WHERE t.asset_id = a.id)
      ORDER BY a.btime DESC,s.asset_id`).all();
    const ignored = new Set(this.db.prepare('SELECT first_id,second_id FROM ignored_similar_pairs')
      .all().map(({ first_id, second_id }) => `${first_id}:${second_id}`));
    return { exact: [...groups.values()], indexed: indexed.length, pending: this.pending.all().length,
      similar: findSimilar(indexed, ignored) };
  }
}

function validSignature(signature) {
  const { id, hash, ratio, red, green, blue } = signature;
  return typeof id === 'string' && /^[a-z0-9_-]{1,80}$/i.test(id) &&
    typeof hash === 'string' && /^[0-9a-f]{16}$/.test(hash) && Number.isFinite(ratio) && ratio > 0 && ratio <= 100000 &&
    [red, green, blue].every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255);
}

function findSimilar(rows, ignored) {
  const candidates = [];
  const indexed = rows.map((row) => ({ ...row, bits: BigInt(`0x${row.hash}`) }));
  for (let i = 0; i < indexed.length && candidates.length < SIMILAR_LIMIT; i++) {
    const a = indexed[i];
    for (let j = i + 1; j < indexed.length && candidates.length < SIMILAR_LIMIT; j++) {
      const b = indexed[j];
      if (a.sha256 === b.sha256 || Math.max(a.ratio, b.ratio) / Math.min(a.ratio, b.ratio) > 1.18 ||
          Math.max(Math.abs(a.red - b.red), Math.abs(a.green - b.green), Math.abs(a.blue - b.blue)) > 36 ||
          ignored.has([a.asset_id, b.asset_id].sort().join(':'))) continue;
      let bits = a.bits ^ b.bits;
      let distance = 0;
      while (bits && distance <= 5) {
        bits &= bits - 1n;
        distance++;
      }
      if (distance <= 5) {
        candidates.push({ left: describe(a), right: describe(b), distance });
      }
    }
  }
  return candidates.sort((a, b) => a.distance - b.distance);
}

function describe({ asset_id, name, ext }) {
  return { id: asset_id, name, ext };
}

module.exports = DuplicateStore;
