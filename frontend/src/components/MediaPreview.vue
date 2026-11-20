<template>
  <section class="media-preview" aria-label="素材预览" @keydown.esc.stop="$emit('close')">
    <header class="preview-header">
      <div class="preview-title">
        <h3 :title="item.name">{{ item.name }}</h3>
        <span>{{ item.ext.toUpperCase() }}</span>
      </div>
      <n-button quaternary circle aria-label="关闭预览" @click="$emit('close')">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </n-button>
    </header>

    <p v-if="failed" class="preview-error" role="status">
      无法播放此文件。请确认原文件仍在素材库中，或用本机播放器打开。
    </p>
    <video v-else-if="item.kind === 'video'" ref="player" class="video-player"
      :src="src" :aria-label="item.name" autoplay controls playsinline preload="metadata" @error="failed = true" />
    <audio v-else ref="player" class="audio-player"
      :src="src" :aria-label="item.name" autoplay controls preload="metadata" @error="failed = true" />
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { NButton } from 'naive-ui';
import { originalUrl } from '../api/index.js';

const props = defineProps({ item: { type: Object, required: true } });
defineEmits(['close']);

const failed = ref(false);
const player = ref(null);
const src = computed(() => originalUrl(props.item.id));

onBeforeUnmount(() => {
  player.value?.pause();
});
</script>

<style scoped>
.media-preview {
  flex-shrink: 0;
  padding: 10px 20px 14px;
  background: #1d1d25;
  border-top: 1px solid #363643;
  color: #eeeef3;
}

.preview-header,
.preview-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.preview-header {
  justify-content: space-between;
  margin-bottom: 4px;
}

.preview-title h3 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  font-weight: 600;
}

.preview-title span {
  color: #b3b4c4;
  font-size: 0.75rem;
}

.audio-player,
.video-player {
}

.audio-player {
  display: block;
  width: min(100%, 38rem);
  height: 42px;
  color-scheme: dark;
}

.video-player {
  display: block;
  width: 100%;
  max-height: min(47vh, 30rem);
  background: #111116;
}

.preview-error {
  color: #ffbfb5;
  font-size: 0.875rem;
  margin: 6px 0;
}
</style>
