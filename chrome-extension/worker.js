const MENU = 'paul-capture-image';
const PREFIX = 'capture:';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU,
      title: '收藏图片到 Paul 素材库',
      contexts: ['image'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU) return;
  openCapture(info, tab).catch(() => console.error('无法打开收藏窗口'));
});

async function openCapture(info, tab) {
  const requestId = crypto.randomUUID();
  const sourceUrl = info.pageUrl || tab?.url || info.frameUrl;
  const imageUrl = info.srcUrl || '';
  const records = await chrome.storage.session.get(null);
  const expired = Object.entries(records).filter(([key]) => key.startsWith(PREFIX))
    .sort((a, b) => b[1].created - a[1].created)
    .filter(([, record], index) => index >= 20 || Date.now() - record.created > 60 * 60 * 1000)
    .map(([key]) => key);
  if (expired.length) await chrome.storage.session.remove(expired);
  const capture = imageUrl.length < 2_000_000 && sourceUrl ? { sourceUrl, imageUrl } : {
    error: '这张图片的地址暂时无法读取。',
  };
  await chrome.storage.session.set({ [`${PREFIX}${requestId}`]: { ...capture, created: Date.now() } });
  await chrome.windows.create({
    url: `${chrome.runtime.getURL('capture.html')}?id=${encodeURIComponent(requestId)}`,
    type: 'popup', width: 458, height: 566, focused: true,
  });
}
