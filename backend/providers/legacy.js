const { readFileSync, readdirSync, statSync } = require('node:fs');
const { basename, join } = require('node:path');

const validId = /^[a-z\d_-]+$/i;

function readMetadata(directory) {
  return JSON.parse(readFileSync(join(directory, 'metadata.json'), 'utf8'));
}

function supportedString(value) {
  return typeof value === 'string' && value !== '' && value === basename(value) && !value.includes('\\') && !value.includes('\0');
}

function makeEntry(directory, key) {
  const record = readMetadata(directory);
  if (record?.id !== key || record.deleted || record.isDeleted ||
      !supportedString(record.name) || !supportedString(record.ext)) return null;
  return {
    item: {
      id: key, name: record.name, ext: record.ext,
      width: record.width, height: record.height, duration: record.duration,
      bpm: record.bpm, btime: record.btime,
      tags: Array.isArray(record.tags) ? record.tags.filter(tag => typeof tag === 'string') : [],
      folderIds: Array.isArray(record.folders) ? record.folders : [],
      sourceUrl: typeof record.url === 'string' ? record.url : null,
      hasThumbnail: statSync(join(directory, `${record.name}_thumbnail.png`), { throwIfNoEntry: false })?.isFile() ?? false,
    },
    note: typeof record.annotation === 'string' ? record.annotation : '',
  };
}

function descendants(folders, parent) {
  const result = new Set([parent]);
  const visit = (branches, below) => {
    for (const branch of branches) {
      const inScope = below || branch.id === parent;
      if (inScope) result.add(branch.id);
      visit(branch.children || [], inScope);
    }
  };
  visit(folders, false);
  return result;
}

class LegacyProvider {
  #files;
  #root;

  constructor(directory) {
    this.#root = directory;
  }

  getFolders() {
    const folders = readMetadata(this.#root).folders;
    return [{ id: '__all__', name: '全部素材' }, ...(Array.isArray(folders) ? folders : [])];
  }

  #directory(id) {
    return join(this.#root, 'images', `${id}.info`);
  }

  #index() {
    if (this.#files) return this.#files;
    const rows = [];
    for (const directory of readdirSync(join(this.#root, 'images'), { withFileTypes: true })) {
      if (!directory.isDirectory() || !directory.name.endsWith('.info')) continue;
      const id = directory.name.slice(0, -5);
      if (!validId.test(id)) continue;
      try {
        const entry = makeEntry(this.#directory(id), id);
        if (entry) rows.push(entry);
      } catch {
        // An unreadable entry should not hide the rest of the library.
      }
    }
    this.#files = rows.sort((a, b) => (b.item.btime || 0) - (a.item.btime || 0) || a.item.id.localeCompare(b.item.id));
    return this.#files;
  }

  getImages(folderId, includeChildren, query) {
    const scope = folderId === '__all__' ? null :
      includeChildren ? descendants(this.getFolders(), folderId) : new Set([folderId]);
    const needle = query.toLocaleLowerCase();
    return this.#index().filter(({ item, note }) =>
      (!scope || item.folderIds.some(id => scope.has(id))) &&
      (!needle || [item.name, note, ...item.tags].some(text => text.toLocaleLowerCase().includes(needle))))
      .map(entry => entry.item);
  }

  pipeFile(id, type, response) {
    if (!validId.test(id)) throw new Error('素材编号无效');
    const root = this.#directory(id);
    const entry = makeEntry(root, id);
    if (!entry) throw new Error('素材不存在');
    const { name, ext } = entry.item;
    response.sendFile(type === 'thumbnail' ? `${name}_thumbnail.png` : `${name}.${ext}`, { root });
  }
}

module.exports = LegacyProvider;
