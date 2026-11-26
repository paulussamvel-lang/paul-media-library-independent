const BASE = 'http://127.0.0.1:13003';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const params = new URLSearchParams(location.search);
const requestId = params.get('id');
const query = (selector) => document.getElementById(selector);
const form = query('capture');
const tagInput = query('tags');
const chosen = new Set();
let record;
let busy = false;
let imageDownload;
function captureImage() {
  if (!imageDownload) {
    imageDownload = readImage(record.imageUrl).catch(error => {
      imageDownload = undefined;
      throw error;
    });
  }
  return imageDownload;
}

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

function videoFrameName(time) {
  const milliseconds = Math.round(time * 1000);
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds / 60000) % 60;
  const seconds = Math.floor(milliseconds / 1000) % 60;
  const position = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join('-');
  return `视频帧 ${position}.${String(milliseconds % 1000).padStart(3, '0')}`;
}

async function initialize() {
  if (!requestId) {
    query('hint').hidden = false;
    return;
  }
  if (params.has('storageError')) throw new Error('本次收藏无法暂存，请关闭暂时不用的收藏窗口后重试。');
  const data = await chrome.storage.session.get(`capture:${requestId}`);
  record = data[`capture:${requestId}`];
  if (record?.kind === 'video') query('heading').textContent = '收藏视频帧';
  if (!record || record.error) throw new Error(record?.error || '这次收藏已关闭，请重新右击要收藏的画面。');
  const image = new URL(record.imageUrl);
  if (!['http:', 'https:', 'data:'].includes(image.protocol)) throw new Error('这张图片没有可下载的地址。');
  const source = new URL(record.sourceUrl);
  if (!['http:', 'https:'].includes(source.protocol)) throw new Error('没有可保存的网页来源。');
  query('source').textContent = source.hostname;
  query('source').href = source.href;
  query('source').title = source.href;
  query('name').value = record.kind === 'video' ? videoFrameName(record.time) : fileName(image);
  const frame = query('frame');
  frame.addEventListener('load', () => {
    query('preview').hidden = false;
    const details = query('frame-details');
    details.textContent = `${frame.naturalWidth} × ${frame.naturalHeight}`;
    details.hidden = false;
  }, { once: true });
  if (record.kind === 'video') {
    frame.src = image.href;
  } else {
    // Reuse the size-limited download on save. A failed preview leaves the form usable.
    captureImage().then(blob => { frame.src = URL.createObjectURL(blob); }).catch(() => {});
  }
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
  const values = { requestId, name: query('name').value.trim(), sourceUrl: record.sourceUrl,
    folderId: query('folder').value || null, tags: [...chosen] };
  busy = true;
  query('save').disabled = true;
  status(record.kind === 'video' ? '正在保存视频帧…' : '正在保存原图…');
  try {
    const image = await captureImage();
    const preview = await previewFor(image).catch(() => ({}));
    const response = await fetch(`${BASE}/api/capture/image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ ...values, ...preview, image: await base64(image) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '保存失败，请确认素材库服务正在运行。');
    const saved = record.kind === 'video' ? '已收藏视频帧和来源链接。' : '已收藏原图和来源链接。';
    status(data.reused ? '已复用相同原件，来源和归类已保存。' : saved);
    query('save').textContent = '已收藏';
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
