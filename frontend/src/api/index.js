const mediaPath = (id, variant) => `/api/file/${encodeURIComponent(id)}/${variant}`;
export const originalUrl = id => mediaPath(id, 'original');
export const thumbnailUrl = id => mediaPath(id, 'thumbnail');

async function request(route, init) {
  const response = await fetch('/api/' + route, init);
  const body = await response.json().catch(() => null);
  if (!response.ok || body === null) throw new Error(body?.error || '素材库请求失败。');
  return body;
}

function submit(route, data) {
  return request(route, {
    method: 'POST', body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
}

export const getFolders = () => request('folders');
export const getConfig = () => request('config');
export const getOrganization = () => request('organization');
export const getSmartFolders = () => request('smart-folders');
export const saveOrganization = (action, data) => submit('organization/' + action, data);
export const saveFolder = data => submit('organization/folder', data);
export const saveSmartFolder = (action, data) => submit('smart-folders/' + action, data);
export const importFile = data => submit('import/file', data);
export const getDuplicates = (needsIndex = false) => request(needsIndex ? 'duplicates/pending' : 'duplicates');
export const updateDuplicates = (action, data) => submit('duplicates/' + action, data);

export function getImages(folder, descendants, signal, query) {
  const parameters = new URLSearchParams({ folderId: folder });
  if (descendants) parameters.append('includeSubfolders', 'true');
  if (query) parameters.append('q', query);
  return request('images?' + parameters.toString(), { signal });
}

export function importFileStream(file, metadata, progress) {
  const header = JSON.stringify(Object.assign({}, metadata, { size: file.size }));
  const payload = new Blob([header, '\n', file], { type: 'application/octet-stream' });
  const upload = new XMLHttpRequest();
  upload.open('POST', '/api/import/stream');
  upload.responseType = 'json';
  return new Promise((resolve, reject) => {
    upload.upload.addEventListener('progress', update => {
      if (update.lengthComputable) progress(Math.round(100 * update.loaded / update.total));
    });
    upload.addEventListener('load', () => {
      const accepted = upload.status >= 200 && upload.status < 300 && upload.response;
      if (accepted) resolve(upload.response);
      else reject(new Error(upload.response?.error || '导入失败，请重试。'));
    }, { once: true });
    const disconnected = () => reject(new Error('导入中断，请重试。'));
    upload.addEventListener('error', disconnected, { once: true });
    upload.addEventListener('abort', disconnected, { once: true });
    upload.send(payload);
  });
}
