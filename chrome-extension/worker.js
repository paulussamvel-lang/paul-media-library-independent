const IMAGE_MENU = 'paul-capture-image';
const VIDEO_MENU = 'paul-capture-video-frame';
const PREFIX = 'capture:';
const WINDOW_PREFIX = 'capture-window:';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'update') retireSiteDragSettings().catch(console.error);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: IMAGE_MENU,
      title: '收藏图片到 Paul 素材库',
      contexts: ['image'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
    chrome.contextMenus.create({
      id: VIDEO_MENU,
      title: '抓取当前视频帧到 Paul 素材库',
      contexts: ['video'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
});

async function retireSiteDragSettings() {
  const scripts = await chrome.scripting.getRegisteredContentScripts();
  const ids = scripts.map((script) => script.id).filter((id) => id.startsWith('paul-drag-'));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
  const settings = await chrome.storage.local.get(null);
  const keys = Object.keys(settings).filter((key) => key.startsWith('drag:'));
  if (keys.length) await chrome.storage.local.remove(keys);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== IMAGE_MENU && info.menuItemId !== VIDEO_MENU) return;
  openCapture(info, tab).catch(() => console.error('无法打开收藏窗口'));
});

chrome.windows.onRemoved.addListener(async (id) => {
  const windowKey = `${WINDOW_PREFIX}${id}`;
  const records = await chrome.storage.session.get(windowKey);
  if (records[windowKey]) await chrome.storage.session.remove([windowKey, records[windowKey]]);
});

// Runs in the frame where the user opened the context menu.
function captureVideoFrame(srcUrl, expectedUrl) {
  if (expectedUrl && location.href !== expectedUrl) {
    return { error: '播放页面已切换，请在视频画面上重新右击。' };
  }
  const videos = [...document.querySelectorAll('video')];
  const matches = srcUrl ? videos.filter((video) => video.currentSrc === srcUrl) : videos;
  if (matches.length !== 1) {
    return { error: '无法确定要抓取的视频。请在播放器画面上右击，或用浏览器的「将视频帧另存为…」。' };
  }
  return captureCurrentVideoFrame(matches[0]);
}

async function readVideoFrame(info, tab, sourceUrl) {
  try {
    const target = { tabId: tab.id, frameIds: [info.frameId ?? 0] };
    await chrome.scripting.executeScript({ target, files: ['video-frame.js'] });
    const [{ result }] = await chrome.scripting.executeScript({
      target,
      func: captureVideoFrame,
      args: [info.srcUrl || '', info.frameUrl || sourceUrl],
    });
    return result || { error: '没有读到视频帧，请在视频画面上重新右击。' };
  } catch {
    return { error: '当前页面无法直接抓帧。可以试试浏览器的「将视频帧另存为…」。' };
  }
}

function readImageAddress(imageUrl) {
  if (imageUrl && imageUrl.length < 2_000_000) return { imageUrl };
  return { error: '这张图片的地址暂时无法读取。' };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'paul:drag-capture' || sender.id !== chrome.runtime.id || !sender.tab) return;
  const sourceUrl = sender.tab.url || sender.url;
  if (!/^https?:\/\//.test(sourceUrl || '')) return;
  const { kind } = message;
  if (kind !== 'image' && kind !== 'video') return;
  const data = kind === 'image' ? readImageAddress(message.imageUrl) : message.frame;
  if (kind === 'video' && !data?.error &&
      (typeof data?.imageUrl !== 'string' || !data.imageUrl.startsWith('data:image/png;base64,') ||
       data.imageUrl.length > 2_800_000 || !Number.isFinite(data.time) || data.time < 0)) return;
  openCaptureWindow({ ...data, kind, sourceUrl })
    .then(() => respond({ ok: true }), () => respond({ ok: false }));
  return true;
});

async function savePendingCapture(requestId, capture) {
  const records = await chrome.storage.session.get(null);
  const expired = Object.entries(records).filter(([key]) => key.startsWith(PREFIX))
    .sort((a, b) => b[1].created - a[1].created)
    .filter(([, record], index) => index >= 20 || Date.now() - record.created > 60 * 60 * 1000)
    .map(([key]) => key);
  if (expired.length) await chrome.storage.session.remove(expired);
  await chrome.storage.session.set({ [`${PREFIX}${requestId}`]: { ...capture, created: Date.now() } });
}

async function openCapture(info, tab) {
  const sourceUrl = info.pageUrl || tab?.url || info.frameUrl;
  const isVideo = info.menuItemId === VIDEO_MENU;
  const data = isVideo ? await readVideoFrame(info, tab, sourceUrl) : readImageAddress(info.srcUrl);
  await openCaptureWindow({ ...data, sourceUrl, kind: isVideo ? 'video' : 'image' });
}

async function openCaptureWindow(record) {
  const requestId = crypto.randomUUID();
  const isVideo = record.kind === 'video';
  const query = new URLSearchParams({ id: requestId });
  try {
    await savePendingCapture(requestId, record);
  } catch {
    query.set('storageError', '1');
  }
  const window = await chrome.windows.create({
    url: `${chrome.runtime.getURL('capture.html')}?${query}`,
    type: 'popup', width: 458, height: isVideo ? 690 : 566, focused: true,
  });
  if (window?.id !== undefined && !query.has('storageError')) {
    await chrome.storage.session.set({ [`${WINDOW_PREFIX}${window.id}`]: `${PREFIX}${requestId}` });
  }
}
