<template>
  <n-config-provider :theme="darkTheme" :preflight-style-disabled="true" class="workspace">
    <aside v-if="!compact" class="library-nav" aria-label="素材库导航">
      <header class="nav-heading">
        <strong>Paul 素材库</strong>
        <n-button size="tiny" quaternary aria-label="图库信息" @click="information = true">图库信息</n-button>
        <n-button size="tiny" quaternary aria-label="收起侧边栏" @click="setCompact(true)">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m9 3-4 4 4 4" fill="none" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </n-button>
      </header>
      <nav class="nav-content" aria-label="文件夹">
        <FolderNavigation :folders="folders" :active="selected?.id" @choose="select" />
        <SmartFolders v-if="entry?.type === 'managed'" :folders="folders" :selected-id="selected?.id"
          :can-edit="entry.canOrganize" @select="select" @removed="restoreSelection"/>
      </nav>
    </aside>
    <section class="workspace-content" aria-label="素材">
      <AssetShelf v-if="selected" :key="selected.kind === 'smart' ? `${selected.id}:${selected.version}` : 'folders'"
        :folder="selected" :folders="folders" :writable="entry.canOrganize"
        :compact="compact" @expand="setCompact(false)" />
      <div v-else class="workspace-message">
        <p v-if="failure" role="status">{{ failure }}</p>
        <p v-else role="status">正在打开图库…</p>
        <n-button v-if="failure" size="small" @click="initialize">重试</n-button>
      </div>
    </section>
    <n-modal v-model:show="information" title="图库信息" preset="card" class="library-info">
      <dl v-if="entry">
        <dt>当前图库</dt><dd>{{ entry.name }}</dd>
        <dt>所在位置</dt><dd>{{ entry.path }}</dd>
      </dl>
      <p v-else>图库尚未加载。</p>
    </n-modal>
  </n-config-provider>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { darkTheme, NButton, NConfigProvider, NModal } from 'naive-ui';
import AssetShelf from './components/AssetShelf.vue';
import FolderNavigation from './components/FolderNavigation.vue';
import SmartFolders from './components/SmartFolders.vue';
import { getConfig, getFolders } from './api/index.js';

const folders = ref([]);
const selected = ref(null);
const entry = ref(null);
const failure = ref('');
const information = ref(false);
const compact = ref(localStorage.getItem('paul-library-nav') === 'compact' ||
  localStorage.getItem('eagle-web-sidebar-collapsed') === '1');

function select(folder) { selected.value = folder; }
function restoreSelection(id) {
  if (selected.value?.id === id) select(folders.value[0]);
}
function setCompact(value) {
  compact.value = value;
  localStorage.setItem('paul-library-nav', value ? 'compact' : 'full');
  localStorage.removeItem('eagle-web-sidebar-collapsed');
}

async function initialize() {
  failure.value = '';
  try {
    const [status, listing] = await Promise.all([getConfig(), getFolders()]);
    folders.value = listing;
    entry.value = status.activeLibrary;
    selected.value = listing.find(folder => folder.id === '__all__') ?? listing[0];
    if (!selected.value) failure.value = '图库里没有可浏览的文件夹。';
  } catch {
    failure.value = '图库无法读取。';
  }
}
onMounted(initialize);
</script>

<style scoped>
.workspace { display: flex; min-width: 0; height: 100%; overflow: hidden; }
.library-nav { width: 232px; max-width: 42vw; flex: none; display: flex; flex-direction: column; background: var(--panel); border-right: 1px solid var(--line); }
.nav-heading { min-height: 56px; display: flex; gap: 4px; align-items: center; padding-inline: 10px; border-bottom: 1px solid var(--line); }
.nav-heading strong { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .85rem; }
.nav-content { padding: 10px; overflow: auto; }
.workspace-content { min-width: 0; flex: 1; display: flex; }
.workspace-message { margin: auto; text-align: center; color: var(--text-muted); }
.workspace-message button { margin-top: 10px; }
.library-info { width: min(480px, calc(100vw - 24px)); }
.library-info dl { display: grid; grid-template-columns: max-content 1fr; gap: 12px; margin: 0; }
.library-info dt { color: var(--text-muted); }
.library-info dd { margin: 0; overflow-wrap: anywhere; }
</style>
