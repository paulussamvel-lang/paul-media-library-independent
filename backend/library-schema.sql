PRAGMA foreign_keys = ON;
PRAGMA user_version = 1;

CREATE TABLE library (id INTEGER PRIMARY KEY CHECK (id = 1), source_json TEXT NOT NULL);
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES folders(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  btime REAL,
  rating REAL,
  notes TEXT,
  source_url TEXT,
  original_name TEXT NOT NULL,
  thumbnail_name TEXT,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  source_json TEXT NOT NULL
);
CREATE TABLE asset_folders (
  asset_id TEXT NOT NULL REFERENCES assets(id),
  folder_id TEXT NOT NULL REFERENCES folders(id),
  PRIMARY KEY (asset_id, folder_id)
);
CREATE TABLE asset_tags (
  asset_id TEXT NOT NULL REFERENCES assets(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (asset_id, tag)
);
CREATE INDEX assets_sha256 ON assets(sha256);
CREATE INDEX asset_folders_folder ON asset_folders(folder_id, asset_id);
CREATE INDEX asset_tags_tag ON asset_tags(tag, asset_id);
