<template>
  <span class="audio-tile" :class="{ playing: preview, 'audio-wide': wide }">
    <span class="audio-metadata">
      <span>{{ item.ext.toUpperCase() }}</span>
      <span v-if="item.bpm > 0">{{ Math.round(item.bpm) }} BPM</span>
    </span>
    <span class="audio-plot" ref="plot" aria-hidden="true"
      @pointerenter="reportPosition" @pointermove="reportPosition">
      <img v-if="useThumbnail" :src="thumbnailUrl(item.id)" alt="" draggable="false"
        loading="lazy" @error="useThumbnail = false" />
      <canvas v-else-if="decoded" ref="canvas" width="288" height="80"></canvas>
      <span v-else class="audio-baseline"></span>
      <span v-if="preview" class="audio-progress" :style="{ width: `${preview.progress * 100}%` }"></span>
    </span>
    <span class="audio-caption">
      <span class="audio-name">{{ item.name }}</span>
      <span v-if="time" class="audio-duration">
        <span v-if="preview" class="audio-elapsed">{{ formatTime(preview.seconds) }} / </span>{{ time }}
      </span>
    </span>
  </span>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { thumbnailUrl } from '../api/index.js';
import { audioWaveform } from '../audio-waveform.js';
import { formatTime } from '../asset-model.js';

const props = defineProps({ item: Object, preview: Object, wide: Boolean });
const emit = defineEmits(['seek-hover']);
const useThumbnail = ref(Boolean(props.item.hasThumbnail));
const plot = ref(null);
const canvas = ref(null);
const decoded = ref(null);
let observer;
let alive = true;

const time = computed(() => {
  const duration = props.preview?.duration || Number(props.item.duration) || decoded.value?.duration;
  if (!Number.isFinite(duration) || duration <= 0) return '';
  return formatTime(Math.max(1, Math.round(duration)));
});

function reportPosition(event) {
  if (event.pointerType !== 'mouse' || event.buttons) return;
  const { left, width } = event.currentTarget.getBoundingClientRect();
  if (width > 0) emit('seek-hover', Math.min(1, Math.max(0, (event.clientX - left) / width)));
}

function observePlot() {
  if (useThumbnail.value || !plot.value) return;
  observer = new IntersectionObserver(async ([entry]) => {
    if (!entry.isIntersecting) return;
    observer.disconnect();
    const waveform = await audioWaveform(props.item.id).catch(() => null);
    if (!alive || !waveform) return;
    decoded.value = waveform;
    await nextTick();
    const drawing = canvas.value?.getContext('2d');
    if (!drawing) return;
    const { width, height } = drawing.canvas;
    const step = width / waveform.peaks.length;
    drawing.fillStyle = '#819587';
    waveform.peaks.forEach((peak, index) => {
      const bar = Math.max(2, peak * height);
      drawing.fillRect(index * step, (height - bar) / 2, step - 0.6, bar);
    });
  });
  observer.observe(plot.value);
}

onMounted(observePlot);
watch(useThumbnail, observePlot, { flush: 'post' });
onUnmounted(() => {
  alive = false;
  observer?.disconnect();
});
</script>

<style scoped>
.audio-tile {
  display: grid;
  height: 100%;
  grid-template-rows: 23px minmax(0, 1fr) 28px;
  padding: 3px 9px;
  background: transparent;
}

.audio-metadata,
.audio-caption {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.audio-metadata,
.audio-duration {
  color: var(--text-muted);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

.audio-duration {
  flex: 0 0 auto;
  white-space: nowrap;
}

.audio-elapsed {
  color: var(--accent);
}

.audio-name {
  overflow: hidden;
  font-size: 0.8125rem;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.audio-plot {
  position: relative;
  display: grid;
  min-height: 0;
  align-items: center;
}

.audio-plot img,
.audio-plot canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding-block: 3px;
  object-fit: fill;
  opacity: 0.86;
}

.audio-plot img {
  filter: grayscale(1) brightness(var(--wave-brightness));
}

.playing .audio-plot :is(img, canvas) {
  opacity: 1;
}

.audio-baseline {
  height: 1px;
  background: var(--line);
}

.audio-progress {
  position: absolute;
  inset-block: 0;
  left: 0;
  border-right: 2px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  pointer-events: none;
}

.audio-wide {
  grid-template: minmax(0,1fr) / minmax(116px,1fr) minmax(54px,2fr) 62px 78px;
  gap: 10px;
  align-items: center;
  padding: 5px 10px;
}
.audio-wide .audio-caption { display: contents; }
.audio-wide .audio-name { grid-area: 1 / 1; font-weight: 600; }
.audio-wide .audio-plot { grid-area: 1 / 2; height: 100%; }
.audio-wide .audio-metadata { grid-area: 1 / 3; justify-content: end; }
.audio-wide .audio-metadata span:first-child { display: none; }
.audio-wide .audio-duration { grid-area: 1 / 4; justify-self: end; }
@media (max-width: 670px) {
  .audio-wide { grid-template-columns: minmax(65px,.8fr) minmax(48px,1.5fr) 38px; gap: 6px; padding-inline: 5px; }
  .audio-wide .audio-metadata, .audio-wide .audio-elapsed { display: none; }
  .audio-wide .audio-duration { grid-column: 3; }
}
</style>
