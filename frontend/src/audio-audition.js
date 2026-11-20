import { ref, shallowRef } from 'vue';
import { originalUrl } from './api/index.js';

export function useAudioAudition() {
  const active = ref(null);
  const preview = shallowRef(null);
  let media;
  let startJob;
  let seekJob;
  let ratio = 0;

  function stop() {
    clearTimeout(startJob);
    clearTimeout(seekJob);
    seekJob = null;
    const previous = media;
    media = null;
    if (previous) {
      previous.pause();
      previous.removeAttribute('src');
      previous.load();
    }
    active.value = null;
    preview.value = null;
    ratio = 0;
  }

  function length(player) {
    return Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0;
  }

  function show(player, seconds) {
    const duration = length(player);
    if (duration) preview.value = { seconds, duration, progress: Math.min(1, seconds / duration) };
  }

  function position(player) {
    const end = length(player);
    return Math.min(ratio * end, end - Math.min(0.12, end * 0.04));
  }

  function play(player) {
    player.play().catch(() => { if (player === media) stop(); });
  }

  function applyPosition(player) {
    if (!length(player)) return;
    const seconds = position(player);
    if (Math.abs(player.currentTime - seconds) > 0.015) player.currentTime = seconds;
    show(player, seconds);
  }

  function start(id, tile) {
    stop();
    active.value = id;
    startJob = setTimeout(() => {
      if (!tile.isConnected || !tile.matches(':hover') || document.hidden) return stop();
      const player = new Audio();
      media = player;
      player.preload = 'metadata';
      player.onloadedmetadata = () => {
        if (media !== player) return;
        applyPosition(player);
        play(player);
      };
      player.ontimeupdate = () => {
        if (media === player && seekJob === null && !player.seeking) show(player, player.currentTime);
      };
      player.onerror = () => { if (media === player) stop(); };
      player.src = originalUrl(id);
    }, 220);
  }

  function seek(id, requested) {
    if (active.value !== id || requested === ratio) return;
    ratio = requested;
    const player = media;
    if (!player || !length(player)) return;
    show(player, position(player));
    if (seekJob !== null) return;
    seekJob = setTimeout(() => {
      seekJob = null;
      const restart = player.ended;
      applyPosition(player);
      if (restart) play(player);
    }, 45);
  }

  return { active, preview, start, stop, seek };
}
