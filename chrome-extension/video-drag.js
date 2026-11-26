(() => {
  let source;
  let frame;
  let hint;

  function reset() {
    if (source) {
      if (source.attribute === null) source.handle.removeAttribute('draggable');
      else source.handle.setAttribute('draggable', source.attribute);
    }
    hint?.remove();
    hint = undefined;
    frame = undefined;
    source = undefined;
  }

  window.addEventListener('pointerdown', (event) => {
    reset();
    if (!chrome.runtime?.id || !event.isTrusted || event.button !== 0 || event.pointerType !== 'mouse' ||
        event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const handle = event.composedPath()[0];
    if (!(handle instanceof HTMLElement)) return;
    let video = handle instanceof HTMLVideoElement ? handle : null;
    // Bilibili can place the scrolling comment layer above the actual video.
    if (!video && handle.closest('.bpx-player-dm-wrap, .bpx-player-video-wrap')) {
      video = document.elementsFromPoint(event.clientX, event.clientY).find((el) => el instanceof HTMLVideoElement);
    }
    if (!video || handle.closest('button, input, a, [role="slider"], [role="button"]')) return;
    source = { handle, video, attribute: handle.getAttribute('draggable') };
    handle.draggable = true;
  }, true);

  window.addEventListener('dragstart', (event) => {
    if (!source || !event.isTrusted || !chrome.runtime?.id || event.target !== source.handle) return;
    frame = captureCurrentVideoFrame(source.video);
    event.dataTransfer.setData('application/x-paul-video-frame', '1');
    event.dataTransfer.effectAllowed = 'copy';
    event.stopImmediatePropagation();
    hint = document.createElement('div');
    hint.textContent = '松手收藏视频帧到 Paul · Esc 取消';
    hint.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;padding:8px 14px;border-radius:6px;background:#202128;color:white;font:14px system-ui';
    (document.fullscreenElement || document.body).append(hint);
  }, true);

  window.addEventListener('dragover', (event) => {
    if (!frame || !event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, true);

  window.addEventListener('drop', (event) => {
    if (!frame || !event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const captured = frame;
    reset();
    chrome.runtime.sendMessage({ type: 'paul:drag-capture', kind: 'video', frame: captured }).catch(() => {});
  }, true);

  window.addEventListener('pointerup', () => { if (!frame) reset(); }, true);
  window.addEventListener('pointercancel', () => { if (!frame) reset(); }, true);
  window.addEventListener('dragend', reset, true);
  window.addEventListener('pagehide', reset, true);
})();
