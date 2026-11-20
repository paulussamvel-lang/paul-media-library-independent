const fs = require('node:fs');
const path = require('node:path');

function optionalJson(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch {
    return null;
  }
}

function legacyEntry(value, overrideName) {
  return { name: overrideName || path.basename(value).replace(/\.library$/i, '').replace(/^Eagle\.G\./, ''), path: value };
}

function legacyEntries(environment) {
  try {
    const configured = JSON.parse(environment.LIBRARIES_JSON || '[]');
    const entries = Array.isArray(configured) ? configured
      .filter(entry => typeof entry?.path === 'string' && entry.path)
      .map(entry => legacyEntry(entry.path, entry.name)) : [];
    if (entries.length) return entries;
  } catch {
    console.warn('图库配置 JSON 无法读取，使用指定的旧库路径。');
  }
  const directory = environment.EAGLE_LIBRARY_PATH || environment.EAGLE_LIBRARY;
  if (!directory) throw new Error('请通过 PAUL_LIBRARY_PATH 或 EAGLE_LIBRARY_PATH 指定图库。');
  return [legacyEntry(directory)];
}

function resolveRuntime(environment = process.env) {
  const current = environment.PAUL_LIBRARY_PATH;
  const libraries = current ?
    [{ type: 'managed', name: path.basename(current), path: current }] : legacyEntries(environment);
  const preferences = optionalJson(path.join(__dirname, 'config.json'));
  const requested = preferences?.activeLibraryIndex;
  const index = Number.isInteger(requested) && requested >= 0 && requested < libraries.length ? requested : 0;
  const port = Number(environment.PAUL_PORT || 13003);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('本机服务端口无效。');
  return { libraries, index, entry: libraries[index], writable: Boolean(current) && environment.PAUL_LIBRARY_WRITABLE === '1', port };
}

module.exports = { resolveRuntime };
