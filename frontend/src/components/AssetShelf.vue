<template>
  <div class="asset-workspace">
    <header class="shelf-heading">
      <n-button v-if="compact" size="small" secondary aria-label="展开侧边栏" @click="$emit('expand')">文件夹</n-button>
      <h1>{{ folder.name }}</h1>
      <label v-if="!smart && !trash && folder.id !== '__all__'" class="subfolders">
        <input v-model="children" type="checkbox" />包含子文件夹
      </label>
    </header>
    <section class="shelf-controls" aria-label="查找素材">
      <div class="search-line">
        <n-input v-model:value="query" clearable size="small" maxlength="160"
          placeholder="输入名称、标签或备注" :input-props="{ 'aria-label': '搜索素材' }"/>
        <n-button size="small" secondary :type="tempoFilter ? 'primary' : 'default'"
          :aria-expanded="expanded" aria-controls="tempo-controls" @click="expanded = !expanded">BPM 筛选</n-button>
      </div>
      <fieldset v-if="expanded" id="tempo-controls" class="tempo-controls" aria-label="BPM 筛选条件">
        <label for="tempo-min">最低 BPM</label>
        <input id="tempo-min" v-model.number="low" type="number" min="1" max="999" placeholder="不限"/>
        <label for="tempo-max">最高 BPM</label>
        <input id="tempo-max" v-model.number="high" type="number" min="1" max="999" placeholder="不限"/>
        <label for="tempo-sort">排序</label>
        <select id="tempo-sort" v-model="order">
          <option value="recent">最近添加</option>
          <option value="asc">BPM 从慢到快</option>
          <option value="desc">BPM 从快到慢</option>
        </select>
        <n-button size="tiny" secondary :disabled="!tempoFilter && validTempo" @click="clearTempo">清除</n-button>
        <p v-if="!validTempo" class="tempo-error" role="status">请输入 1–999，最低 BPM 不得高于最高 BPM。</p>
      </fieldset>
    </section>
    <BatchOrganizer v-if="writable" :selecting="picking" :ids="busy ? [] : selectedIds"
      :total="busy ? 0 : filtered.length" :folders="folders" :trash="trash" @toggle="switchSelection"
      @select-all="selectResults" @clear="selection.clear()" @change="refresh++" />
    <LibraryTools v-if="writable && !trash" :folders="folders" :selected-folder-id="folder.id" @change="refresh++" />

    <section ref="frame" class="asset-scroll" aria-label="素材结果" :aria-busy="busy" @scroll="recordScroll">
      <div class="empty-message" v-if="busy" role="status">正在读取素材…</div>
      <div class="empty-message" v-else-if="error" role="status">
        <p>无法读取这个文件夹。</p><n-button size="small" @click="refresh++">重试</n-button>
      </div>
      <div class="empty-message" v-else-if="!filtered.length" role="status">
        {{ tempoFilter ? '没有符合 BPM 条件的音频' : trash && !text ? '回收站为空' : '没有找到素材' }}
      </div>
      <div v-else class="shelf-plane" :style="{ height: `${layout.height}px` }">
        <button v-for="position in onscreen" :key="position.asset.id" type="button"
          class="asset-tile" :class="`asset-${position.asset.kind}`"
          :title="position.asset.name" :aria-label="labelOf(position.asset)"
          :aria-pressed="picking ? selection.has(position.asset.id) : undefined"
          :style="positionStyle(position)"
          :disabled="!picking && position.asset.kind === 'file'" :draggable="draggable(position.asset)"
          @pointerenter="considerAudition(position.asset, $event)" @pointerleave="stopAudition"
          @pointerdown="stopAudition" @dragstart="drag(position.asset, $event)"
          @click="view(position.asset, $event)">
          <AudioTile v-if="position.asset.kind === 'audio'" :item="position.asset"
            :preview="audioId === position.asset.id ? audioPreview : null"
            @seek-hover="seekAudition(position.asset.id, $event)"/>
          <template v-else>
            <img v-if="['video','image'].includes(position.asset.kind)" :src="thumbnailUrl(position.asset.id)"
              alt="" loading="lazy" draggable="false" @error="showFallback(position.asset, $event)"/>
            <span class="card-caption">
              <span class="card-name">{{ position.asset.name }}</span>
              <span class="card-format">{{ position.asset.ext.toUpperCase() }}</span>
            </span>
          </template>
          <span v-if="picking && selection.has(position.asset.id)" class="selection-tag" aria-hidden="true">已选</span>
        </button>
      </div>
    </section>
    <MediaPreview v-if="player" :key="player.id" :item="player" @close="closePlayer"/>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import { NButton, NInput } from 'naive-ui';
import AudioTile from './AudioTile.vue';
import BatchOrganizer from './BatchOrganizer.vue';
import LibraryTools from './LibraryTools.vue';
import MediaPreview from './MediaPreview.vue';
import { getImages, originalUrl, thumbnailUrl } from '../api/index.js';
import { displayAsset, layOutShelf } from '../asset-model.js';
import { showPhotos } from '../photo-preview.js';
import { useAudioAudition } from '../audio-audition.js';

const props = defineProps({ folder: { type: Object, required: true }, folders: Array, writable: Boolean, compact: Boolean });
defineEmits(['expand']);
const full = shallowRef([]);
const player = ref(null);
const smart = computed(() => props.folder.kind === 'smart');
const trash = computed(() => props.folder.id === '__trash__');
const children = ref(false);
const query = ref('');
const text = ref('');
const reading = ref(true);
const error = ref(false);
const refresh = ref(0);
const expanded = ref(false);
const low = ref('');
const high = ref('');
const order = ref('recent');
const picking = ref(false);
const selection = reactive(new Set());
const selectedIds = computed(() => filtered.value.filter(asset => selection.has(asset.id)).map(asset => asset.id));
const busy = computed(() => reading.value || text.value !== query.value.trim());
const frame = ref(null);
const scroll = reactive({ offset: 0, width: 0, height: 0 });
const { active: audioId, preview: audioPreview, start: startAudition, stop: stopAudition, seek: seekAudition } = useAudioAudition();
let watchSize;
let photos;
let returnFocus;

const validTempo = computed(() => {
  const acceptable = value => value === '' || Number.isInteger(value) && value >= 1 && value <= 999;
  return acceptable(low.value) && acceptable(high.value) &&
    (low.value === '' || high.value === '' || low.value <= high.value);
});
const tempoFilter = computed(() => validTempo.value && (low.value !== '' || high.value !== '' || order.value !== 'recent'));
const filtered = computed(() => {
  if (!tempoFilter.value) return full.value;
  const lower = low.value === '' ? 1 : low.value;
  const upper = high.value === '' ? Infinity : high.value;
  const tracks = full.value.filter(row => {
    const bpm = Math.round(row.bpm);
    return row.kind === 'audio' && bpm >= lower && bpm <= upper;
  });
  if (order.value !== 'recent') {
    const direction = order.value === 'asc' ? 1 : -1;
    tracks.sort((a, b) => direction * (Math.round(a.bpm) - Math.round(b.bpm)));
  }
  return tracks;
});
const layout = computed(() => layOutShelf(filtered.value, scroll.width));
const onscreen = computed(() => {
  const from = scroll.offset - 500;
  const until = scroll.offset + scroll.height + 500;
  return layout.value.positions.filter(pos => pos.top < until && pos.top + pos.height > from);
});

watch(query, (value, _, cleanup) => {
  const delay = setTimeout(() => { text.value = value.trim(); }, 150);
  cleanup(() => clearTimeout(delay));
});

watch([() => props.folder.id, children, text, refresh], async ([id, descend, search], _, cleanup) => {
  clearInteraction();
  const controller = new AbortController();
  cleanup(() => controller.abort());
  reading.value = true;
  error.value = false;
  full.value = [];
  try {
    const result = await getImages(id, descend, controller.signal, search);
    if (!controller.signal.aborted) full.value = result.map(displayAsset);
  } catch {
    if (!controller.signal.aborted) error.value = true;
  } finally {
    if (!controller.signal.aborted) reading.value = false;
  }
}, { immediate: true });
watch([low, high, order], clearInteraction);

onMounted(() => {
  watchSize = new ResizeObserver(() => {
    scroll.width = frame.value.clientWidth;
    scroll.height = frame.value.clientHeight;
  });
  watchSize.observe(frame.value);
  window.addEventListener('blur', stopAudition);
  document.addEventListener('visibilitychange', stopAudition);
});
onUnmounted(() => {
  watchSize?.disconnect();
  clearInteraction();
  window.removeEventListener('blur', stopAudition);
  document.removeEventListener('visibilitychange', stopAudition);
});

function recordScroll() {
  stopAudition();
  scroll.offset = frame.value.scrollTop;
}
function positionStyle({ left, top, width, height }) {
  return { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px' };
}
function clearTempo() {
  low.value = '';
  high.value = '';
  order.value = 'recent';
}
function clearInteraction() {
  stopAudition();
  selection.clear();
  photos?.close();
  player.value = null;
  returnFocus = null;
  scroll.offset = 0;
  if (frame.value) frame.value.scrollTop = 0;
}
function switchSelection() {
  stopAudition();
  picking.value = !picking.value;
  selection.clear();
  closePlayer();
}
function selectResults() {
  selection.clear();
  for (const asset of filtered.value) selection.add(asset.id);
}
function labelOf(asset) {
  const action = picking.value ? '选择' : asset.kind === 'audio' ? '试听' : '预览';
  return action + ' ' + asset.name;
}
function draggable(asset) {
  return !trash.value && !picking.value && asset.kind !== 'file' && typeof window.mediaLibrary?.startDrag === 'function';
}
function drag(asset, event) {
  stopAudition();
  if (!draggable(asset)) return;
  event.preventDefault();
  window.mediaLibrary.startDrag(asset.id);
}
function considerAudition(asset, pointer) {
  if (!picking.value && !photos && !player.value && asset.kind === 'audio' && pointer.pointerType === 'mouse' && !pointer.buttons) {
    startAudition(asset.id, pointer.currentTarget);
  }
}
function view(asset, event) {
  stopAudition();
  if (picking.value) {
    if (selection.has(asset.id)) selection.delete(asset.id);
    else selection.add(asset.id);
    return;
  }
  returnFocus = event.currentTarget;
  if (asset.kind === 'image') {
    player.value = null;
    photos = showPhotos(filtered.value, asset.id, () => {
      photos = null;
      returnFocus?.focus({ preventScroll: true });
    });
  } else if (asset.kind === 'audio' || asset.kind === 'video') {
    player.value = asset;
  }
}
function closePlayer() {
  player.value = null;
  returnFocus?.focus({ preventScroll: true });
  returnFocus = null;
}
function showFallback(asset, event) {
  const image = event.currentTarget;
  const fallback = originalUrl(asset.id);
  if (asset.kind === 'image' && image.getAttribute('src') !== fallback) image.src = fallback;
  else image.style.visibility = 'hidden';
}
</script>

<style scoped>
.asset-workspace { display: flex; flex-direction: column; width: 100%; min-width: 0; overflow: hidden; }
.shelf-heading { padding: 10px 16px; min-height: 56px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); }
.shelf-heading h1 { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-size: 1rem; }
.subfolders { display: flex; align-items: center; gap: 6px; font-size: .8125rem; color: var(--text-muted); }
.shelf-controls { padding: 8px 16px; }
.search-line, .tempo-controls { display: flex; align-items: center; gap: 8px; }
.tempo-controls { flex-wrap: wrap; font-size: .8125rem; margin: 8px 0 0; padding: 0; border: 0; min-width: 0; color: var(--text-muted); }
.tempo-controls input, .tempo-controls select { min-height: 30px; border-radius: 4px; border: 1px solid var(--line); background: var(--panel); color: inherit; padding: 3px 6px; }
.tempo-controls input { width: 68px; }
.tempo-error { flex-basis: 100%; color: #ffb5ab; }
.asset-scroll { flex: 1; min-height: 0; overflow-y: auto; }
.empty-message { display: grid; justify-items: center; gap: 8px; padding: 34px 8px; color: var(--text-muted); }
.shelf-plane { position: relative; }
.asset-tile { position: absolute; border: 0; padding: 0; border-radius: 8px; overflow: hidden; background: var(--panel); color: inherit; text-align: start; }
.asset-tile[draggable='true'] { cursor: grab; }
.asset-tile[draggable='true']:active { cursor: grabbing; }
.asset-tile:enabled:hover { filter: brightness(1.12); }
.asset-tile:focus-visible, .asset-tile[aria-pressed='true'] { outline: 2px solid var(--focus); outline-offset: -2px; }
.asset-tile img { object-fit: cover; display: block; width: 100%; height: 100%; }
.card-caption { background: #1d232de6; position: absolute; inset: auto 0 0; display: flex; align-items: center; gap: 8px; padding: 7px 9px; font-size: .78rem; }
.card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.card-format { color: var(--text-muted); font-size: .68rem; }
.selection-tag { position: absolute; inset: 5px 6px auto auto; background: #abdee8; color: #18212a; border-radius: 3px; padding: 2px 5px; font-size: .7rem; }
.asset-audio[aria-pressed='true'] :deep(.audio-metadata) { padding-right: 32px; }
</style>
