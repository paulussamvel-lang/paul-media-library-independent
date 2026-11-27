<template>
  <div ref="workspace" class="asset-workspace">
    <header class="shelf-toolbar" aria-label="素材工具栏">
      <n-button v-if="compact" size="small" secondary aria-label="展开侧边栏" @click="$emit('expand')">文件夹</n-button>
      <n-input v-model:value="query" clearable size="small" maxlength="160" class="shelf-search"
          placeholder="搜索名称、标签或备注" :input-props="{ 'aria-label': '搜索素材' }">
        <template #prefix><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg></template>
      </n-input>
      <div class="view-switch" role="group" aria-label="素材视图">
        <button v-for="item in views" :key="item.id" type="button" :aria-pressed="mode === item.id"
          :disabled="picking && item.id !== 'list'" @click="setView(item.id)">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path v-if="item.id === 'waveform'" d="M2 9v2m4-6v10m4-13v16m4-12v8m4-6v4"/>
            <path v-else-if="item.id === 'waterfall'" d="M2.5 3h6v5h-6zM2.5 11h6v6h-6zM11.5 3h6v8h-6zM11.5 14h6v3h-6z"/>
            <path v-else d="M3 5h2m3 0h9M3 10h2m3 0h9M3 15h2m3 0h9"/>
          </svg>{{ item.name }}</button>
      </div>
      <slot name="appearance"/>
    </header>
    <section class="shelf-controls" aria-label="素材筛选">
      <div class="shelf-heading">
        <div class="folder-heading">
          <h1 :title="folder.name">{{ folder.name }}</h1>
          <span v-if="!busy" class="result-count">{{ visible.length }} 项</span>
        </div>
        <div class="shelf-actions">
          <label v-if="!smart && !trash && folder.id !== '__all__'" class="subfolders">
            <input v-model="children" type="checkbox" />包含子文件夹
          </label>
          <n-button v-if="!trash" size="small" secondary :type="tempoFilter ? 'primary' : 'default'"
            :aria-expanded="expanded" aria-controls="tempo-controls" @click="expanded = !expanded">BPM 筛选</n-button>
          <n-button v-if="writable && !trash && !picking" size="small" secondary
            :disabled="!renameTarget || busy || !!edit" @click="renameSelected">重命名</n-button>
          <LibraryTools v-if="writable && !trash" :folders="folders" :selected-folder-id="folder.id" @change="refresh++" />
          <n-button v-if="mode !== 'list'" class="detail-toggle" size="tiny" quaternary :aria-pressed="details"
            @click="details = !details">{{ details ? '隐藏详情' : '显示详情' }}</n-button>
        </div>
      </div>
      <div v-if="mode === 'waterfall'" class="gallery-controls">
        <div class="view-switch media-switch" role="group" aria-label="素材类型">
          <button v-for="item in mediaTypes" :key="item.id" type="button" :aria-pressed="mediaType === item.id"
            @click="mediaType = item.id">{{ item.name }}</button>
        </div>
        <n-button v-if="detailAsset && detailAsset.kind !== 'file'" size="tiny" secondary @click="openPreview(detailAsset, $event)">打开预览</n-button>
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
    <div class="shelf-body" :data-view="mode">
      <div class="shelf-results">
        <div v-if="mode === 'list' && visible.length && !busy" class="row-columns list-head" aria-hidden="true">
          <span>名称</span><span>格式</span><span>文件夹</span><span>标签</span><span>时长</span>
        </div>
        <div v-if="mode === 'waveform' && visible.length && !busy" class="wave-head list-head" aria-hidden="true">
          <span>名称</span><span>波形</span><span>BPM</span><span>时长</span>
        </div>
        <section ref="frame" class="asset-scroll" aria-label="素材结果" :aria-busy="busy" @scroll="recordScroll">
          <div class="empty-message" v-if="busy" role="status">正在读取素材…</div>
          <div class="empty-message" v-else-if="error" role="status">
            <p>无法读取这个文件夹。</p><n-button size="small" @click="refresh++">重试</n-button>
          </div>
          <div class="empty-message" v-else-if="!visible.length" role="status">
            {{ tempoFilter ? '没有符合 BPM 条件的音频' : trash && !text ? '回收站为空' :
              mode === 'waveform' && full.length ? '这个视图没有可试听的音频' : '没有找到素材' }}
          </div>
          <div v-else class="shelf-plane" :style="{ height: `${layout.height}px` }">
            <button v-for="position in onscreen" :key="position.asset.id" type="button"
              class="asset-tile" :class="[`asset-${position.asset.kind}`, {
                'row-columns list-row': mode === 'list', 'wave-row': mode === 'waveform',
                auditioning: audioId === position.asset.id,
                named: !picking && highlighted === position.asset.id,
              }]"
              :title="position.asset.name" :aria-label="labelOf(position.asset)"
              :aria-pressed="picking ? selection.has(position.asset.id) :
                highlighted === position.asset.id"
              :data-asset-id="position.asset.id"
              :style="positionStyle(position)"
              :draggable="draggable(position.asset)"
              @pointerenter="considerAudition(position.asset, $event)" @pointerleave="stopAudition"
              @pointerdown="onTileDown" @dragstart="drag(position.asset, $event)"
              @click="view(position.asset, $event)" @dblclick="openGalleryAsset(position.asset, $event)"
              @keydown.f2.prevent="beginRename(position.asset, $event.currentTarget)"
              @keydown.enter="onAssetEnter(position.asset, $event)">
              <template v-if="mode === 'list'">
                <span class="list-name">
                  <span v-if="picking" class="row-check" aria-hidden="true"></span><span data-asset-name>{{ position.asset.name }}</span>
                </span>
                <span class="row-meta">{{ position.asset.ext.toUpperCase() }}</span>
                <span class="row-meta" :title="folderNames(position.asset)">{{ folderNames(position.asset) }}</span>
                <span class="row-meta" :title="position.asset.tags?.join('、')">{{ position.asset.tags?.join('、') || '—' }}</span>
                <span class="row-meta row-time">{{ durationLabel(position.asset) }}</span>
              </template>
              <AudioTile v-else-if="position.asset.kind === 'audio'" :item="position.asset" :wide="mode === 'waveform'"
                :preview="audioId === position.asset.id ? audioPreview : null"
                @seek-hover="seekAudition(position.asset.id, $event)"/>
              <template v-else>
                <span class="card-cover">
                  <span class="format-cover" aria-hidden="true">{{ position.asset.ext.toUpperCase() }}</span>
                  <img v-if="position.asset.kind === 'image' || position.asset.kind === 'video' && position.asset.hasThumbnail"
                    :src="position.asset.hasThumbnail ? thumbnailUrl(position.asset.id) : originalUrl(position.asset.id)"
                    alt="" loading="lazy" draggable="false" @error="showFallback(position.asset, $event)" />
                  <video v-else-if="position.asset.kind === 'video'" class="video-still"
                    :src="stillUrl(position.asset)" aria-hidden="true" draggable="false" muted playsinline preload="metadata"
                    @loadeddata="showVideoStill" />
                </span>
                <span class="card-caption">
                  <span class="card-name" data-asset-name>{{ position.asset.name }}</span>
                  <span class="card-format">{{ position.asset.ext.toUpperCase() }}</span>
                </span>
              </template>
            </button>
            <div v-if="edit" class="inline-rename" :style="edit.style">
              <input ref="nameInput" v-model="edit.value" aria-label="素材新名称" maxlength="160" title="回车保存，Esc 取消"
                :readonly="edit.pending" :aria-invalid="!!edit.error" :aria-describedby="edit.error ? 'rename-error' : undefined"
                @keydown="editKey" @blur="cancelRename(false)" />
              <p v-if="edit.error" id="rename-error" role="alert">{{ edit.error }}</p>
            </div>
          </div>
        </section>
      </div>
      <aside v-if="details && mode !== 'list'" class="asset-details" aria-label="素材详情">
        <h2>素材详情</h2>
        <template v-if="detailAsset && !busy">
          <img v-if="detailAsset.kind === 'image' || detailAsset.kind === 'video' && detailAsset.hasThumbnail"
            :key="detailAsset.id" :src="detailAsset.hasThumbnail ? thumbnailUrl(detailAsset.id) : originalUrl(detailAsset.id)"
            alt="" @error="showFallback(detailAsset, $event)" />
          <video v-else-if="detailAsset.kind === 'video'" :key="detailAsset.id" class="video-still"
            :src="stillUrl(detailAsset)" aria-hidden="true" muted playsinline preload="metadata" @loadeddata="showVideoStill" />
          <h3>{{ detailAsset.name }}</h3>
          <dl>
            <dt>格式</dt><dd>{{ detailAsset.ext.toUpperCase() }}</dd>
            <dt>文件夹</dt><dd>{{ folderNames(detailAsset) }}</dd>
            <template v-if="detailAsset.duration > 0"><dt>时长</dt><dd>{{ durationLabel(detailAsset) }}</dd></template>
            <template v-if="detailAsset.bpm > 0"><dt>BPM</dt><dd>{{ Math.round(detailAsset.bpm) }}</dd></template>
            <dt>标签</dt><dd>{{ detailAsset.tags?.join('、') || '—' }}</dd>
            <template v-if="sources.length">
              <dt>来源</dt>
              <dd><a v-for="source in sources" :key="source" :href="source" :title="source"
                target="_blank" rel="noopener noreferrer">{{ sourceHost(source) }}</a></dd>
            </template>
          </dl>
        </template>
      </aside>
    </div>
    <div v-if="mode === 'waveform' && !player" class="audition-bar">
      <span :title="auditionName">{{ auditionName || '悬停试听' }}</span>
      <progress :value="audioPreview?.progress ?? 0" max="1" aria-label="试听进度"></progress>
      <span>{{ audioPreview ? formatTime(audioPreview.seconds) + ' / ' + formatTime(audioPreview.duration) : '—' }}</span>
    </div>
    <MediaPreview v-if="player" :key="player.id" :item="player" :start-at="playerStart" @close="closePlayer"/>
    <Teleport v-if="photoTrashError" to="body">
      <p class="photo-trash-error" role="alert">{{ photoTrashError }}</p>
    </Teleport>
    <BatchOrganizer ref="organizer" v-if="writable" :selecting="picking" :ids="busy ? [] : selectedIds"
      :total="busy ? 0 : visible.length" :folders="folders" :trash="trash" @toggle="switchSelection"
      @select-all="selectResults" @clear="selection.clear()" @change="refresh++" />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import { NButton, NInput } from 'naive-ui';
import AudioTile from './AudioTile.vue';
import BatchOrganizer from './BatchOrganizer.vue';
import LibraryTools from './LibraryTools.vue';
import MediaPreview from './MediaPreview.vue';
import { getImages, originalUrl, saveOrganization, thumbnailUrl } from '../api/index.js';
import { defaultView, displayAsset, formatTime, layOutRows, layOutShelf } from '../asset-model.js';
import { folderOptions } from '../folders.js';
import { showPhotos, validLinks } from '../photo-preview.js';
import { useAudioAudition } from '../audio-audition.js';

const props = defineProps({ folder: { type: Object, required: true }, folders: Array, writable: Boolean, compact: Boolean });
defineEmits(['expand']);
const full = shallowRef([]);
const player = ref(null);
const playerStart = ref(0);
const edit = ref(null);
const nameInput = ref(null);
const organizer = ref(null);
const workspace = ref(null);
const photoTrashError = ref('');
let trashPending = false;
let nameClickAt = -Infinity;
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
const views = [{ id: 'waveform', name: '波形' }, { id: 'waterfall', name: '瀑布' }, { id: 'list', name: '列表' }];
const mediaTypes = [{ id: 'all', name: '全部' }, { id: 'video', name: '视频' }, { id: 'image', name: '图片' }];
const manualView = ref(null);
const automaticView = ref(defaultView(props.folder, []));
const browseView = computed(() => manualView.value ?? automaticView.value);
const mode = computed(() => picking.value ? 'list' : browseView.value);
const mediaType = ref('all');
const details = ref(true);
const highlighted = ref(null);
const selection = reactive(new Set());
const selectedIds = computed(() => visible.value.filter(asset => selection.has(asset.id)).map(asset => asset.id));
const knownFolders = computed(() => new Map(folderOptions(props.folders).map(({ id, path }) => [id, path])));
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
const visible = computed(() => {
  if (browseView.value === 'waveform') return filtered.value.filter(asset => asset.kind === 'audio');
  if (browseView.value === 'waterfall' && mediaType.value !== 'all') {
    return filtered.value.filter(asset => asset.kind === mediaType.value);
  }
  return filtered.value;
});
const renameTarget = computed(() => visible.value.find(asset => asset.id === highlighted.value));
const detailAsset = computed(() => {
  const id = mode.value === 'waveform' ? audioId.value ?? highlighted.value : highlighted.value;
  return visible.value.find(asset => asset.id === id) ?? visible.value[0];
});
const sources = computed(() => validLinks(detailAsset.value?.sourceUrls || [detailAsset.value?.sourceUrl]));
const auditionName = computed(() => visible.value.find(asset => asset.id === audioId.value)?.name);
const layout = computed(() => {
  if (mode.value === 'waterfall') return layOutShelf(visible.value, scroll.width);
  return layOutRows(visible.value, scroll.width, mode.value === 'waveform' ? 70 : 42);
});
const onscreen = computed(() => {
  const from = scroll.offset - 500;
  const until = scroll.offset + scroll.height + 500;
  return layout.value.positions.filter(pos => pos.top < until && pos.top + pos.height > from);
});

watch(query, (value, _, cleanup) => {
  const delay = setTimeout(() => { text.value = value.trim(); }, 150);
  cleanup(() => clearTimeout(delay));
});

watch(() => props.folder.id, () => {
  manualView.value = null;
  automaticView.value = defaultView(props.folder, []);
  mediaType.value = 'all';
  picking.value = false;
  expanded.value = false;
  clearTempo();
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
    if (!controller.signal.aborted) {
      full.value = result.map(displayAsset);
      if (!search) automaticView.value = defaultView(props.folder, full.value);
    }
  } catch {
    if (!controller.signal.aborted) error.value = true;
  } finally {
    if (!controller.signal.aborted) reading.value = false;
  }
}, { immediate: true });
watch([low, high, order], clearInteraction);
watch([mode, mediaType], resetViewport);
watch(onscreen, positions => {
  if (edit.value && !positions.some(row => row.asset.id === edit.value.id)) edit.value = null;
});

onMounted(() => {
  watchSize = new ResizeObserver(() => {
    scroll.width = frame.value.clientWidth;
    scroll.height = frame.value.clientHeight;
  });
  watchSize.observe(frame.value);
  window.addEventListener('blur', stopAudition);
  window.addEventListener('keydown', trashPreviewOnDelete);
  document.addEventListener('visibilitychange', stopAudition);
});
onUnmounted(() => {
  watchSize?.disconnect();
  clearInteraction();
  window.removeEventListener('blur', stopAudition);
  window.removeEventListener('keydown', trashPreviewOnDelete);
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
  selection.clear();
  photos?.close();
  player.value = null;
  returnFocus = null;
  highlighted.value = null;
  resetViewport();
}
function resetViewport() {
  edit.value = null;
  nameClickAt = -Infinity;
  stopAudition();
  scroll.offset = 0;
  if (frame.value) frame.value.scrollTop = 0;
}
function setView(view) {
  if (!picking.value) manualView.value = view;
}
function switchSelection() {
  stopAudition();
  picking.value = !picking.value;
  selection.clear();
  closePlayer();
}
function selectResults() {
  selection.clear();
  for (const asset of visible.value) selection.add(asset.id);
}
function labelOf(asset) {
  const action = picking.value ? '选择' : asset.kind === 'audio' ? '试听' : mode.value === 'waterfall' ? '查看' : '预览';
  return action + ' ' + asset.name;
}
function folderNames(asset) {
  return (asset.folderIds || []).map(id => knownFolders.value.get(id)).filter(Boolean).join('、') || '—';
}
function durationLabel(asset) {
  return asset.duration > 0 ? formatTime(asset.duration) : '—';
}
function sourceHost(value) {
  return new URL(value).hostname;
}
function stillUrl(asset) {
  return originalUrl(asset.id) + '#t=0.1';
}
function showVideoStill(event) {
  event.currentTarget.style.visibility = 'visible';
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
  if (mode.value !== 'list' && !photos && !player.value && asset.kind === 'audio' &&
      pointer.pointerType === 'mouse' && !pointer.buttons) {
    startAudition(asset.id, pointer.currentTarget);
  }
}
function onTileDown(event) {
  if (!event.target.closest('[data-asset-name]')) stopAudition();
}

async function renameSelected() {
  const asset = renameTarget.value;
  if (!asset || !frame.value) return;
  const selector = `[data-asset-id="${CSS.escape(asset.id)}"]`;
  let tile = frame.value.querySelector(selector);
  if (!tile) {
    const position = layout.value.positions.find(row => row.asset.id === asset.id);
    if (!position) return;
    frame.value.scrollTop = position.top;
    recordScroll();
    await nextTick();
    tile = frame.value?.querySelector(selector);
  }
  if (tile && renameTarget.value?.id === asset.id) {
    tile.scrollIntoView({ block: 'nearest' });
    beginRename(asset, tile);
  }
}

function beginRename(asset, tile) {
  if (!props.writable || trash.value || picking.value || busy.value || edit.value?.pending) return;
  if (asset.kind === 'audio' && player.value?.id !== asset.id) openPreview(asset, { currentTarget: tile });
  const label = tile.querySelector('[data-asset-name]');
  const bounds = label.getBoundingClientRect();
  const plane = tile.parentElement.getBoundingClientRect();
  const width = Math.min(plane.width - 8, Math.max(180, bounds.width));
  const left = Math.max(4, Math.min(bounds.left - plane.left - 4, plane.width - width - 4));
  const suffix = '.' + asset.ext;
  const ending = asset.ext && asset.name.toLowerCase().endsWith(suffix.toLowerCase())
    ? asset.name.slice(-suffix.length) : '';
  highlighted.value = asset.id;
  edit.value = { id: asset.id, value: ending ? asset.name.slice(0, -ending.length) : asset.name,
    ending, tile, error: '', pending: false, style: { left: left + 'px',
      top: Math.max(0, bounds.top - plane.top + (bounds.height - 32) / 2) + 'px', width: width + 'px' } };
  nextTick(() => { nameInput.value?.focus({ preventScroll: true }); nameInput.value?.select(); });
}

function cancelRename(restoreFocus) {
  const current = edit.value;
  if (!current || current.pending) return;
  edit.value = null;
  nameClickAt = -Infinity;
  if (restoreFocus) current.tile.focus({ preventScroll: true });
}

function editKey(event) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault();
    if (event.key === 'Enter') saveName();
    else cancelRename(true);
  }
}

async function saveName() {
  const current = edit.value;
  if (!current || current.pending) return;
  const pattern = current.value.trim().normalize('NFC');
  current.pending = true;
  current.error = '';
  try {
    const result = await saveOrganization('apply', { action: 'rename', ids: [current.id], renameMode: 'sequence', pattern });
    const name = pattern + current.ending;
    const rows = full.value.map(item => item.id === current.id ? { ...item, name } : item);
    full.value = rows;
    if (player.value?.id === current.id) player.value = { ...player.value, name };
    organizer.value?.setLatestEdit(result.latestEdit);
    if (edit.value === current) {
      current.pending = false;
      cancelRename(true);
    }
    if (text.value || smart.value) {
      // Reevaluate name-based matches without unmounting the playing track.
      const matching = await getImages(props.folder.id, children.value, undefined, text.value);
      if (full.value === rows) full.value = matching.map(displayAsset);
    }
  } catch (error) {
    current.pending = false;
    current.error = error.message;
  }
}

function view(asset, event) {
  if (props.writable && !trash.value && !picking.value && event.target.closest('[data-asset-name]')) {
    const now = performance.now();
    if (highlighted.value === asset.id && nameClickAt !== -Infinity && now - nameClickAt >= 350 && event.detail === 1) {
      beginRename(asset, event.currentTarget);
      return;
    }
    nameClickAt = now;
    highlighted.value = asset.id;
    if (asset.kind === 'audio' && player.value?.id !== asset.id) openPreview(asset, event);
    return;
  }
  nameClickAt = -Infinity;
  stopAudition();
  if (picking.value) {
    if (selection.has(asset.id)) selection.delete(asset.id);
    else selection.add(asset.id);
    return;
  }
  highlighted.value = asset.id;
  if (mode.value === 'waterfall' && asset.kind !== 'audio') return;
  openPreview(asset, event);
}
function openGalleryAsset(asset, event) {
  if (!picking.value && mode.value === 'waterfall' && asset.kind !== 'audio') openPreview(asset, event);
}
function onAssetEnter(asset, event) {
  if (!picking.value && mode.value === 'waterfall' && asset.kind !== 'audio') {
    event.preventDefault();
    openPreview(asset, event);
  }
}
function openPreview(asset, event) {
  if (asset.kind === 'file' || photos) return;
  playerStart.value = audioId.value === asset.id ? audioPreview.value?.seconds ?? 0 : 0;
  stopAudition();
  highlighted.value = asset.id;
  returnFocus = event.currentTarget;
  if (asset.kind === 'image') {
    player.value = null;
    photos = showPhotos(visible.value, asset.id, () => {
      photos = null;
      photoTrashError.value = '';
      returnFocus?.focus({ preventScroll: true });
    });
  } else if (asset.kind === 'audio' || asset.kind === 'video') {
    player.value = asset;
  }
}
function trashPreviewOnDelete(event) {
  if (!props.writable || trash.value || picking.value || busy.value || edit.value ||
      event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat ||
      event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      (event.key !== 'Delete' && event.key !== 'Backspace')) return;
  const target = event.target;
  if (!(target instanceof Element) ||
      target.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="dialog"]:not(.pswp)')) return;
  const photo = photos;
  const id = photo?.currSlide?.data.assetId ?? player.value?.id;
  if (!id || (photo ? !photo.element?.contains(target) : !workspace.value?.contains(target) && target !== document.body)) return;
  event.preventDefault();
  if (!trashPending) void trashPreview(id, photo);
}

async function trashPreview(id, photo) {
  trashPending = true;
  photoTrashError.value = '';
  try {
    const result = await saveOrganization('apply', { action: 'trash', ids: [id] });
    if (photo && photos === photo) photo.close();
    if (player.value?.id === id) closePlayer();
    full.value = full.value.filter(asset => asset.id !== id);
    selection.delete(id);
    if (highlighted.value === id) highlighted.value = null;
    organizer.value?.reportTrash(result.latestEdit);
  } catch (error) {
    if (photo && photos === photo) photoTrashError.value = error.message;
    else organizer.value?.reportTrashError(error.message);
  } finally {
    trashPending = false;
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
.photo-trash-error {
  position: fixed; z-index: 100001; bottom: 20px; left: 50%; transform: translateX(-50%);
  max-width: calc(100vw - 32px); padding: 8px 12px; border-radius: 6px;
  background: var(--panel); color: var(--danger);
}
.asset-workspace { display: flex; flex-direction: column; width: 100%; min-width: 0; overflow: hidden; }
.shelf-toolbar { min-height: 62px; padding: 9px 16px; background: var(--panel); border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.shelf-search { flex: 1 1 176px; min-width: 0; width: auto; }
.view-switch { display: flex; flex: none; padding: 2px; gap: 2px; background: var(--surface); border: 1px solid var(--line); border-radius: 7px; }
.view-switch button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: transparent; color: var(--text-muted); border: 0; border-radius: 4px; padding: 3px 9px; min-height: 28px; white-space: nowrap; cursor: pointer; font-size: .75rem; }
.view-switch button:not(:disabled):hover { background: var(--hover); color: var(--text); }
.view-switch button[aria-pressed='true'] { background: var(--accent); color: var(--accent-ink); font-weight: 650; }
.view-switch button[aria-pressed='true']:hover { background: var(--accent); color: var(--accent-ink); }
.view-switch button:disabled { opacity: .65; cursor: default; }
.shelf-heading, .folder-heading, .shelf-actions { display: flex; align-items: center; gap: 8px; min-width: 0; }
.shelf-heading, .shelf-actions { flex-wrap: wrap; }
.shelf-heading { justify-content: space-between; }
.folder-heading { flex: 1 1 135px; }
.shelf-heading h1 { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: clamp(1.3rem, 2vw, 1.65rem); letter-spacing: -.025em; line-height: 1.35; font-weight: 650; }
.result-count { flex: none; font-size: .75rem; color: var(--text-muted); }
.gallery-controls { display: flex; align-items: center; gap: 8px; margin-top: 9px; }
.media-switch { background: transparent; border: 0; padding: 0; gap: 4px; }
.media-switch button { border-radius: 5px; min-height: 25px; }
.media-switch button[aria-pressed='true'], .media-switch button[aria-pressed='true']:hover { background: var(--selected); color: var(--text); }
.subfolders { display: flex; align-items: center; gap: 6px; font-size: .8125rem; color: var(--text-muted); }
.shelf-controls { padding: 16px 16px 12px; border-bottom: 1px solid var(--line); }
.tempo-controls { display: flex; align-items: center; gap: 8px; }
.tempo-controls { flex-wrap: wrap; font-size: .8125rem; margin: 8px 0 0; padding: 0; border: 0; min-width: 0; color: var(--text-muted); }
.tempo-controls input, .tempo-controls select { min-height: 30px; border-radius: 4px; border: 1px solid var(--line); background: var(--panel); color: inherit; padding: 3px 6px; }
.tempo-controls input { width: 68px; }
.tempo-error { flex-basis: 100%; color: var(--danger); }
.shelf-body { flex: 1; display: flex; min-height: 0; min-width: 0; }
.shelf-results { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.asset-scroll { flex: 1; min-height: 0; overflow: hidden auto; }
.empty-message { display: grid; justify-items: center; gap: 8px; padding: 34px 8px; color: var(--text-muted); }
.shelf-plane { position: relative; }
.inline-rename { position: absolute; z-index: 2; }
.inline-rename input { width: 100%; height: 32px; padding: 4px 7px; font-size: .8125rem; border-radius: 5px; border: 1px solid var(--accent); color: var(--text); background: var(--panel); }
.inline-rename p { margin-top: 4px; padding: 4px 7px; background: var(--panel); color: var(--danger); font-size: .75rem; }
.asset-tile.named { box-shadow: inset 0 0 0 1px var(--accent); }

.asset-tile { position: absolute; border: 0; padding: 0; border-radius: 9px; overflow: hidden; background: var(--surface); color: inherit; text-align: start; cursor: pointer; }
.asset-tile[draggable='true'] { cursor: grab; }
.asset-tile[draggable='true']:active { cursor: grabbing; }
.asset-tile:hover { background: var(--hover); }
.asset-tile:focus-visible, .asset-tile[aria-pressed='true'] { outline: 2px solid var(--focus); outline-offset: -2px; }
.card-cover { position: absolute; inset: 0 0 35px; display: grid; place-items: center; background: var(--panel); }
.card-cover :is(img, video) { position: absolute; inset: 0; object-fit: cover; width: 100%; height: 100%; pointer-events: none; }
.video-still { visibility: hidden; }
.format-cover { font-size: .8125rem; font-weight: 650; color: var(--text-muted); }
.card-caption { position: absolute; inset: auto 0 0; min-height: 35px; display: flex; align-items: center; gap: 8px; padding: 6px 9px; font-size: .8125rem; }
.card-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.card-format { color: var(--text-muted); font-size: .72rem; }
.wave-row, .list-row { border-radius: 0; border-bottom: 1px solid var(--line); background: transparent; }
.wave-row.auditioning, .list-row[aria-pressed='true'] { background: var(--selected); }
.list-row[aria-pressed='true']:not(:focus-visible) { outline: none; }
.row-columns { display: grid; grid-template-columns: minmax(90px,2fr) 46px minmax(64px,1.1fr) minmax(55px,1fr) 53px; gap: 10px; align-items: center; padding-inline: 9px; }
.list-head { margin: 0 16px; min-height: 36px; background: var(--panel); color: var(--text-muted); font-size: .75rem; }
.list-row:nth-child(even):not(:hover):not([aria-pressed=true]) { background: color-mix(in srgb, var(--surface) 42%, transparent); }
.wave-head { display: grid; grid-template-columns: var(--wave-columns); gap: 10px; padding-inline: 10px; align-items: center; }
.wave-head span:nth-last-child(-n+2) { text-align: end; }
@media (max-width: 670px) { .wave-head { padding-inline: 5px; gap: 6px; } .wave-head span:nth-child(3) { display: none; } }
.list-name { display: flex; min-width: 0; align-items: center; gap: 8px; font-size: .8125rem; font-weight: 550; }
.list-name > span:last-child, .row-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-meta { font-size: .75rem; color: var(--text-muted); }
.list-head span:last-child, .row-time { text-align: end; font-variant-numeric: tabular-nums; }
.row-check { position: relative; flex: none; width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--text-muted); }
.list-row[aria-pressed='true'] .row-check { background: var(--accent); border-color: var(--accent); }
.list-row[aria-pressed='true'] .row-check::after { content: ''; position: absolute; width: 4px; height: 8px; left: 4px; top: 1px; border: solid var(--accent-ink); border-width: 0 2px 2px 0; transform: rotate(45deg); }
.asset-details { flex: none; width: clamp(152px, 18vw, 230px); border-left: 1px solid var(--line); padding: 18px 14px; background: var(--panel); overflow: auto; }
.asset-details h2 { margin: 0 0 14px; font-size: .875rem; font-weight: 650; }
.asset-details h3 { margin: 12px 0; font-size: .9rem; overflow-wrap: anywhere; }
.asset-details :is(img, video) { display: block; width: 100%; max-height: 165px; object-fit: contain; border-radius: 4px; background: var(--ground); }
.asset-details .video-still:not([style]) { display: none; }
.asset-details dl { display: grid; grid-template-columns: max-content minmax(0,1fr); gap: 9px; margin: 12px 0 0; font-size: .75rem; }
.asset-details dt { color: var(--text-muted); }
.asset-details dd { margin: 0; overflow-wrap: anywhere; }
.asset-details a { display: block; margin-bottom: 5px; }
.audition-bar { display: grid; grid-template-columns: minmax(65px, .75fr) minmax(50px,2fr) max-content; align-items: center; gap: 12px; padding: 8px 16px; border-top: 1px solid var(--line); background: var(--panel); font-size: .75rem; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.audition-bar span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.audition-bar progress { width: 100%; height: 6px; border: 0; }
.audition-bar progress::-webkit-progress-bar { background: var(--line); border-radius: 3px; }
.audition-bar progress::-webkit-progress-value { background: var(--accent); border-radius: 3px; }
@media (max-width: 760px) { .asset-details, .shelf-actions .detail-toggle { display: none; } }
@media (max-width: 620px) {
  .row-columns { grid-template-columns: minmax(72px,1fr) 42px 46px; gap: 6px; }
  .row-columns > :nth-child(3), .row-columns > :nth-child(4) { display: none; }
}
</style>
