const BASE = 'http://127.0.0.1:13003';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const requestId = new URLSearchParams(location.search).get('id');
const query = (selector) => document.getElementById(selector);
const form = query('capture');
const tagInput = query('tags');
const chosen = new Set();
let record;
let busy = false;

function status(message, error = false) {
  const target = query('status');
  target.textContent = message;
  target.dataset.error = String(error);
}

function addFolders(tree, parent = '') {
  for (const folder of tree) {
    if (folder.id === '__all__') continue;
    const label = parent ? `${parent} / ${folder.name}` : folder.name;
    query('folder').add(new Option(label, folder.id));
    addFolders(folder.children || [], label);
  }
}

function renderTags() {
  const buttons = [...chosen].map((tag) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag-chip';
    button.textContent = `${tag} ×`;
    button.setAttribute('aria-label', `移除标签 ${tag}`);
    button.addEventListener('click', () => {
      chosen.delete(tag);
      renderTags();
    });
    return button;
  });
  query('chosen-tags').replaceChildren(...buttons);
}

function addEnteredTags() {
  const entered = tagInput.value.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
  const next = new Set([...chosen, ...entered]);
  if (next.size > 30 || entered.some((value) => value.length > 80)) {
    status('最多可填 30 个标签，每个最多 80 个字符。', true);
    return false;
  }
  for (const tag of entered) chosen.add(tag);
  tagInput.value = '';
  renderTags();
  return true;
}

function fileName(url) {
  if (!['http:', 'https:'].includes(url.protocol)) return '网页图片';
  try {
    return decodeURIComponent(url.pathname.split('/').pop()).replace(/\.[a-z0-9]{2,6}$/i, '').slice(0, 60) || '网页图片';
  } catch {
    return '网页图片';
  }
}

async function initialize() {
  if (!requestId) {
    query('hint').hidden = false;
    return;
  }
  const data = await chrome.storage.session.get(`capture:${requestId}`);
  record = data[`capture:${requestId}`];
  if (!record || record.error) throw new Error(record?.error || '这次收藏已关闭，请重新右击图片。');
  const image = new URL(record.imageUrl);
  if (!['http:', 'https:', 'data:'].includes(image.protocol)) throw new Error('这张图片没有可下载的地址。');
  const source = new URL(record.sourceUrl);
  if (!['http:', 'https:'].includes(source.protocol)) throw new Error('没有可保存的网页来源。');
  query('source').textContent = source.href;
  query('source').href = source.href;
  query('source').title = source.href;
  query('name').value = fileName(image);
  query('open-library').href = BASE;
  let result;
  try {
    result = await fetch(`${BASE}/api/capture/options`, { signal: AbortSignal.timeout(6000) });
    if (!result.ok) throw new Error();
  } catch {
    throw new Error('连不上 Paul 素材库，请先打开素材库桌面版。');
  }
  const options = await result.json();
  addFolders(options.folders);
  for (const tag of options.tags) query('known-tags').append(new Option(tag));
  form.hidden = false;
}

async function readImage(url) {
  const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error('原图下载失败。');
  if (Number(response.headers.get('Content-Length')) > MAX_IMAGE_BYTES) throw new Error('原图超过 20 MB。');
  const reader = response.body.getReader();
  const parts = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error('原图超过 20 MB。');
    }
    parts.push(value);
  }
  return new Blob(parts, { type: response.headers.get('Content-Type') || '' });
}

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('无法读取图片。'));
    reader.readAsDataURL(blob);
  });
}

async function previewFor(blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, 480 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#18181e';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    return { width, height, thumbnail };
  } finally {
    bitmap.close();
  }
}

async function submit(event) {
  event.preventDefault();
  if (busy || !addEnteredTags()) return;
  const imageUrl = new URL(record.imageUrl);
  const values = { requestId, name: query('name').value.trim(), sourceUrl: record.sourceUrl,
    folderId: query('folder').value || null, tags: [...chosen] };
  busy = true;
  query('save').disabled = true;
  status('正在保存原图…');
  try {
    if (imageUrl.protocol !== 'data:' && !(imageUrl.protocol === 'http:' && imageUrl.hostname === '127.0.0.1')) {
      const granted = await chrome.permissions.request({ origins: [`${imageUrl.protocol}//${imageUrl.hostname}/*`] });
      if (!granted) throw new Error('没有授予读取图片所在网站的权限。');
    }
    const image = await readImage(imageUrl.href);
    const preview = await previewFor(image).catch(() => ({}));
    const response = await fetch(`${BASE}/api/capture/image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ ...values, ...preview, image: await base64(image) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '保存失败，请确认素材库服务正在运行。');
    status(data.reused ? '已复用相同原件，来源和归类已保存。' : '已收藏原图和来源链接。');
    query('open-library').hidden = false;
    chrome.storage.session.remove(`capture:${requestId}`).catch(() => {});
  } catch (error) {
    busy = false;
    query('save').disabled = false;
    status(error.message === 'Failed to fetch' ? '无法读取这张原图或连接素材库。' : error.message, true);
  }
}

query('add-tag').addEventListener('click', addEnteredTags);
tagInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addEnteredTags();
  }
});
form.addEventListener('submit', submit);
initialize().catch((error) => status(error.message, true));
