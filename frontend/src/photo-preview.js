import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';
import { originalUrl } from './api/index.js';

export function validLinks(list) {
  const allowed = new Set();
  for (const source of list) {
    try {
      const url = new URL(source);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) allowed.add(url.href);
    } catch { /* An old record can have an empty or invalid source. */ }
  }
  return [...allowed];
}

function anchor(href, text) {
  const link = document.createElement('a');
  Object.assign(link, { href, textContent: text, target: '_blank', rel: 'noopener noreferrer' });
  return link;
}

export function showPhotos(assets, selected, onClose) {
  const photos = assets.filter(row => row.kind === 'image');
  const index = photos.findIndex(row => row.id === selected);
  if (index < 0) return null;
  const viewer = new PhotoSwipe({
    index,
    dataSource: photos.map(row => ({
      assetId: row.id,
      src: originalUrl(row.id),
      alt: row.name,
      width: row.width || 640,
      height: row.height || 480,
      links: validLinks(row.sourceUrls || [row.sourceUrl]),
    })),
    showHideAnimationType: 'fade',
  });
  viewer.on('uiRegister', () => viewer.ui.registerElement({
    name: 'reference-links', tagName: 'div', className: 'photo-source', order: 8,
    onInit(container) {
      const render = () => {
        const links = viewer.currSlide?.data.links || [];
        container.hidden = !links.length;
        container.replaceChildren();
        if (links.length === 1) container.append(anchor(links[0], '来源'));
        if (links.length > 1) {
          const list = document.createElement('details');
          const summary = document.createElement('summary');
          summary.textContent = `来源（${links.length}）`;
          list.append(summary, ...links.map(href => anchor(href, href)));
          container.append(list);
        }
      };
      viewer.on('change', render);
      render();
    },
  }));
  viewer.on('destroy', onClose);
  viewer.init();
  return viewer;
}
