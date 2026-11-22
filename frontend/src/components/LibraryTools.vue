<template>
  <div class="library-tools">
    <n-button size="small" secondary @click="showImport">导入文件</n-button>
    <n-button size="small" secondary @click="showReport">查重</n-button>
  </div>

  <n-modal v-model:show="importOpen" preset="card" title="导入文件" class="library-tool-modal"
    :mask-closable="false" :closable="!importing" :close-on-esc="!importing">
    <form class="tool-stack" @submit.prevent="importSelected">
      <label for="import-files">本地文件</label>
      <input id="import-files" type="file" multiple :disabled="importing" @change="chooseFiles" />
      <p class="tool-subtle">每个文件最多 2 GB。内容完全相同的文件会复用原件。</p>
      <label for="import-folder">保存到</label>
      <select id="import-folder" v-model="importFolder" :disabled="importing || importTouched">
        <option value="">未归类</option>
        <option v-for="folder in options" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
      </select>
      <label for="import-tags">标签</label>
      <n-input v-model:value="importTags" :input-props="{ id: 'import-tags' }" placeholder="逗号分隔" :disabled="importing || importTouched" />
      <n-button attr-type="submit" type="primary" :loading="importing" :disabled="!queued || importing">
        {{ importTouched ? '重试未完成项' : '开始导入' }}
      </n-button>
      <p v-if="importMessage" role="status">{{ importMessage }}</p>
      <div v-if="progress !== null" class="import-progress">
        <progress :value="progress" max="100" aria-label="文件上传进度"></progress>
        <span>{{ progress === 100 ? '正在校验' : `${progress}%` }}</span>
      </div>
      <ul v-if="importErrors.length" class="tool-errors" aria-label="导入失败的文件">
        <li v-for="item in importErrors" :key="item.id">{{ item.file.name }} · {{ item.error }}</li>
      </ul>
    </form>
  </n-modal>

  <n-modal v-model:show="reportOpen" preset="card" title="素材查重" class="library-tool-modal duplicate-modal"
    :mask-closable="false" :closable="!scanning" :close-on-esc="!scanning">
    <div class="tool-stack">
      <p v-if="reportError" role="status" class="tool-errors">{{ reportError }}</p>
      <div v-if="report" class="tool-stack">
        <div class="report-summary">
          <span>完全相同 {{ report.exact.length }} 组</span>
          <span>相似候选 {{ report.similar.length }} 对</span>
          <span>已建图片指纹 {{ report.indexed }} 张</span>
        </div>
        <n-button :loading="scanning" :disabled="scanning || !report.pending" @click="scan">
          扫描相似图片<span v-if="report.pending">（{{ report.pending }} 张待扫描）</span>
        </n-button>
        <p v-if="scanStatus" role="status">{{ scanStatus }}</p>
        <details v-if="report.exact.length">
          <summary>完全相同的原件</summary>
          <ol class="exact-list">
            <li v-for="group in report.exact" :key="group[0].id">
              <ul>
                <li v-for="item in group" :key="item.id"><a :href="originalUrl(item.id)" target="_blank" rel="noopener">{{ item.name }}.{{ item.ext }}</a></li>
              </ul>
            </li>
          </ol>
        </details>
        <details v-if="report.similar.length" open>
          <summary>相似图片候选</summary>
          <p class="tool-subtle">显示 {{ report.similar.length }} 对供人工比较。忽略候选只隐藏这一对。</p>
          <div v-for="pair in report.similar" :key="pairKey(pair)" class="similar-pair">
            <a v-for="item in [pair.left, pair.right]" :key="item.id" :href="originalUrl(item.id)" target="_blank" rel="noopener" class="comparison-image">
              <img :src="thumbnailUrl(item.id)" :alt="item.name" loading="lazy" @error="useOriginal($event, item.id)" />
              <span :title="item.name">{{ item.name }}</span>
            </a>
            <n-button size="tiny" :disabled="Boolean(ignoring)" @click="ignore(pair)">忽略此对</n-button>
          </div>
        </details>
      </div>
    </div>
  </n-modal>
</template>

<script setup>
import { computed, ref } from 'vue';
import { NButton, NInput, NModal } from 'naive-ui';
import { getDuplicates, importFile, importFileStream, originalUrl, thumbnailUrl, updateDuplicates } from '../api/index.js';
import { folderOptions } from '../folders.js';
import { imageSignature } from '../image-signature.js';

const props = defineProps({ folders: { type: Array, required: true }, selectedFolderId: { type: String, required: true } });
const emit = defineEmits(['change']);
const options = computed(() => folderOptions(props.folders));
const importOpen = ref(false);
const importing = ref(false);
const importTouched = ref(false);
const importFolder = ref('');
const importTags = ref('');
const importMessage = ref('');
const progress = ref(null);
const files = ref([]);
const queued = computed(() => files.value.some((item) => !item.done));
const importErrors = computed(() => files.value.filter((item) => item.error));
const reportOpen = ref(false);
const report = ref(null);
const reportError = ref('');
const scanning = ref(false);
const scanStatus = ref('');
const ignoring = ref('');

function showImport() {
  if (!importTouched.value) importFolder.value = options.value.some((x) => x.id === props.selectedFolderId) ? props.selectedFolderId : '';
  importOpen.value = true;
}

function chooseFiles(event) {
  files.value = Array.from(event.target.files, (file) => ({ file, id: crypto.randomUUID(), done: false, error: '', reused: false }));
  importMessage.value = '';
  importTouched.value = false;
}

function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('无法读取文件。'));
    reader.readAsDataURL(file);
  });
}

async function dimensions(file) {
  try {
    const bitmap = await createImageBitmap(file);
    try { return { width: bitmap.width, height: bitmap.height }; }
    finally { bitmap.close(); }
  } catch {
    return {};
  }
}

async function importSelected() {
  if (importing.value || !queued.value) return;
  importing.value = true;
  importTouched.value = true;
  const tags = importTags.value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
  let changed = false;
  try {
    for (const item of files.value.filter((entry) => !entry.done)) {
      importMessage.value = `正在导入 ${item.file.name}`;
      item.error = '';
      try {
        if (item.file.size > 2 * 1024 ** 3) throw new Error('超过 2 GB。');
        const suffix = item.file.name.match(/\.([^.]+)$/);
        const extension = suffix?.[1] || '';
        const name = suffix ? item.file.name.slice(0, -suffix[0].length) : item.file.name;
        const metadata = { requestId: item.id, name, extension, folderId: importFolder.value || null, tags };
        let result;
        if (item.file.size > 20 * 1024 ** 2) {
          progress.value = 0;
          result = await importFileStream(item.file, metadata, (value) => { progress.value = value; });
        } else {
          result = await importFile({ ...metadata, image: await encodeFile(item.file), ...await dimensions(item.file) });
        }
        item.done = true;
        item.reused = result.reused;
        changed = true;
      } catch (error) {
        item.error = error.message;
      } finally {
        progress.value = null;
      }
    }
    const completed = files.value.filter((item) => item.done).length;
    const reused = files.value.filter((item) => item.reused).length;
    importMessage.value = `已完成 ${completed}/${files.value.length} 项，复用 ${reused} 项`;
    if (changed) emit('change');
  } finally {
    importing.value = false;
  }
}

async function reloadReport() {
  reportError.value = '';
  try { report.value = await getDuplicates(); }
  catch (error) { reportError.value = error.message; }
}

function showReport() {
  reportOpen.value = true;
  reloadReport();
}

async function scan() {
  if (scanning.value) return;
  scanning.value = true;
  reportError.value = '';
  let processed = 0;
  let skipped = 0;
  try {
    const pending = await getDuplicates(true);
    for (let i = 0; i < pending.length; i += 8) {
      const batch = await Promise.allSettled(pending.slice(i, i + 8).map(imageSignature));
      const entries = batch.filter((item) => item.status === 'fulfilled').map((item) => item.value);
      skipped += batch.length - entries.length;
      if (entries.length) await updateDuplicates('index', { entries });
      processed += batch.length;
      scanStatus.value = `已处理 ${processed}/${pending.length} 张`;
    }
    await reloadReport();
    scanStatus.value = skipped ? `扫描完成，${skipped} 张暂无法生成指纹` : '扫描完成';
  } catch (error) {
    reportError.value = error.message;
  } finally {
    scanning.value = false;
  }
}

function pairKey(pair) { return `${pair.left.id}:${pair.right.id}`; }

async function ignore(pair) {
  ignoring.value = pairKey(pair);
  reportError.value = '';
  try {
    await updateDuplicates('ignore', { left: pair.left.id, right: pair.right.id });
    await reloadReport();
  } catch (error) {
    reportError.value = error.message;
  } finally {
    ignoring.value = '';
  }
}

function useOriginal(event, id) {
  const image = event.currentTarget;
  const fallback = originalUrl(id);
  if (image.getAttribute('src') !== fallback) image.src = fallback;
}
</script>

<style scoped>
.library-tools, .report-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.library-tool-modal { width: min(500px, calc(100vw - 24px)); max-height: 90vh; overflow-y: auto; }
.duplicate-modal { width: min(690px, calc(100vw - 24px)); }
.tool-stack { display: grid; gap: 9px; }
.tool-subtle, .report-summary { color: var(--text-muted); font-size: .8125rem; }
.tool-errors { color: var(--danger); }
.import-progress { display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: .8125rem; }
.import-progress progress { flex: 1; height: 8px; accent-color: var(--accent); }
.tool-stack select { min-height: 32px; padding: 5px; color: var(--text); background: var(--surface); border: 1px solid var(--line); }
.exact-list { max-height: 220px; overflow-y: auto; padding-left: 20px; }
.exact-list li { padding: 2px 0; overflow-wrap: anywhere; }
.exact-list a { color: var(--accent); }
.similar-pair { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) auto; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line); }
.comparison-image { min-width: 0; display: grid; gap: 3px; color: var(--text); }
.comparison-image img { width: 100%; height: 90px; object-fit: contain; background: var(--ground); }
.comparison-image span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
