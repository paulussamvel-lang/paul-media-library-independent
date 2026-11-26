(() => {
  if (globalThis.paulDragInstalled) return;
  globalThis.paulDragInstalled = true;

  const threshold = 12;
  let gesture;
  let suppressClick = false;

  function available(event) {
    return globalThis.chrome?.runtime?.id && event.isTrusted;
  }

  function moved(event, start) {
    return Math.hypot(event.clientX - start.x, event.clientY - start.y) >= threshold;
  }

  window.addEventListener('pointerdown', (event) => {
    gesture = undefined;
    suppressClick = false;
    if (!available(event) || event.pointerType !== 'mouse' || event.shiftKey || event.ctrlKey) return;
    if (event.button !== 0) return;
    const image = event.composedPath().find((element) => element instanceof HTMLImageElement);
    if (image) gesture = { url: image.currentSrc || image.src, id: event.pointerId, x: event.clientX, y: event.clientY };
  }, true);

  window.addEventListener('dragstart', (event) => {
    if (available(event) && gesture) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener('pointerup', (event) => {
    if (!gesture || event.pointerId !== gesture.id || event.button !== 0) return;
    const start = gesture;
    gesture = undefined;
    if (!available(event) || !moved(event, start) || !start.url) return;
    suppressClick = true;
    event.preventDefault();
    event.stopImmediatePropagation();
    chrome.runtime.sendMessage({
      type: 'paul:drag-capture', kind: 'image', imageUrl: start.url,
    }).catch(() => {});
  }, true);

  window.addEventListener('click', (event) => {
    if (!suppressClick || !available(event)) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('pointercancel', () => { gesture = undefined; }, true);
  window.addEventListener('blur', () => { gesture = undefined; }, true);
})();
