const path = require('node:path');

function assetDirectory(library, id) {
  const store = /^capture-[0-9a-f]{32}$/.test(id) ? 'captures' : 'files';
  return path.join(library, store, id);
}

module.exports = { assetDirectory };
