<template>
  <n-config-provider :theme="palette === 'mist' ? null : darkTheme" :theme-overrides="themeOverrides"
    :preflight-style-disabled="true" class="workspace">
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
        <div v-if="entry?.canOrganize" class="folder-actions">
          <n-button size="tiny" quaternary aria-label="新建文件夹" @click="editFolder()">新建文件夹</n-button>
          <n-button v-if="ordinarySelection" size="tiny" quaternary aria-label="改名当前文件夹"
            @click="editFolder(selected)">改名</n-button>
        </div>
        <form v-if="folderEdit" class="folder-edit" @submit.prevent="submitFolder">
          <label for="folder-name">{{ folderEdit.id ? '修改文件夹名称' : '文件夹名称' }}</label>
          <n-input ref="folderInput" v-model:value="folderEdit.name" size="small" :maxlength="160"
            :input-props="{ id: 'folder-name' }" :disabled="savingFolder" />
          <label v-if="!folderEdit.id" for="folder-parent">上级文件夹</label>
          <select v-if="!folderEdit.id" id="folder-parent" v-model="folderEdit.parentId" :disabled="savingFolder">
            <option :value="null">顶层</option>
            <option v-for="item in folderChoices" :key="item.id" :value="item.id">{{ item.path }}</option>
          </select>
          <p v-if="folderError" class="folder-error" role="status">{{ folderError }}</p>
          <div class="folder-edit-buttons">
            <n-button size="tiny" :disabled="savingFolder" @click="folderEdit = null">取消</n-button>
            <n-button size="tiny" attr-type="submit" type="primary" :loading="savingFolder"
              :disabled="!folderEdit.name.trim()">保存文件夹</n-button>
          </div>
        </form>
        <FolderNavigation :folders="folders" :active="selected?.id" @choose="select" />
        <div v-if="entry?.type === 'managed'" class="trash-navigation">
          <FolderNavigation :folders="[trashFolder]" :active="selected?.id" @choose="select" />
        </div>
        <SmartFolders v-if="entry?.type === 'managed'" :folders="folders" :selected-id="selected?.id"
          :can-edit="entry.canOrganize" @select="select" @removed="restoreSelection"/>
      </nav>
    </aside>
    <section class="workspace-content" aria-label="素材">
      <AssetShelf v-if="selected" :key="selected.kind === 'smart' ? `${selected.id}:${selected.version}` :
        selected.id === '__trash__' ? 'trash' : 'folders'"
        :folder="selected" :folders="folders" :writable="entry.canOrganize"
        :compact="compact" @expand="setCompact(false)">
        <template #appearance>
          <select v-model="palette" class="palette-select" aria-label="配色" title="配色">
            <option v-for="option in palettes" :key="option.id" :value="option.id">{{ option.name }}</option>
          </select>
        </template>
      </AssetShelf>
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
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import { darkTheme, NButton, NConfigProvider, NInput, NModal } from 'naive-ui';
import AssetShelf from './components/AssetShelf.vue';
import FolderNavigation from './components/FolderNavigation.vue';
import SmartFolders from './components/SmartFolders.vue';
import { getConfig, getFolders, saveFolder } from './api/index.js';
import { folderOptions } from './folders.js';

const folders = ref([]);
const selected = ref(null);
const entry = ref(null);
const failure = ref('');
const information = ref(false);
const folderEdit = ref(null);
const folderInput = ref(null);
const folderError = ref('');
const savingFolder = ref(false);
const trashFolder = { id: '__trash__', name: '回收站' };
const palettes = [
  { id: 'graphite', name: '石墨青' }, { id: 'midnight', name: '午夜蓝' },
  { id: 'amber', name: '暖炭棕' }, { id: 'dusk', name: '暮紫' }, { id: 'mist', name: '雾白' },
];
const savedPalette = localStorage.getItem('paul-library-palette');
const palette = ref(palettes.some(({ id }) => id === savedPalette) ? savedPalette : 'graphite');
const themeOverrides = shallowRef(null);
watch(palette, id => {
  const root = document.documentElement;
  root.dataset.palette = id;
  localStorage.setItem('paul-library-palette', id);
  const style = getComputedStyle(root);
  const color = name => style.getPropertyValue('--' + name).trim();
  themeOverrides.value = {
    common: {
      primaryColor: color('accent'), primaryColorHover: color('accent'), primaryColorPressed: color('accent'),
      primaryColorSuppl: color('accent'), textColor1: color('text'), textColor2: color('text'),
      textColor3: color('text-muted'), placeholderColor: color('text-muted'), borderColor: color('line'),
      dividerColor: color('line'), inputColor: color('surface'), cardColor: color('surface'),
      modalColor: color('surface'), bodyColor: color('ground'), hoverColor: color('hover'),
    },
    Button: {
      textColorPrimary: color('accent-ink'), textColorHoverPrimary: color('accent-ink'),
      textColorPressedPrimary: color('accent-ink'), textColorFocusPrimary: color('accent-ink'),
    },
  };
}, { immediate: true });
const folderChoices = computed(() => folderOptions(folders.value));
const ordinarySelection = computed(() => folderChoices.value.some(({ id }) => id === selected.value?.id));
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

async function editFolder(folder) {
  if (savingFolder.value) return;
  folderError.value = '';
  folderEdit.value = folder ? { id: folder.id, name: folder.name } :
    { name: '', parentId: ordinarySelection.value ? selected.value.id : null };
  await nextTick();
  folderInput.value?.focus();
}

async function submitFolder() {
  if (savingFolder.value || !folderEdit.value.name.trim()) return;
  folderError.value = '';
  savingFolder.value = true;
  try {
    const { id, folders: listing } = await saveFolder({ ...folderEdit.value });
    folders.value = listing;
    const find = tree => {
      for (const folder of tree) {
        if (folder.id === id) return folder;
        const child = folder.children && find(folder.children);
        if (child) return child;
      }
    };
    select(find(listing) ?? listing[0]);
    folderEdit.value = null;
  } catch (error) {
    folderError.value = error.message;
  } finally {
    savingFolder.value = false;
  }
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
.library-nav { width: 204px; max-width: 36vw; flex: none; display: flex; flex-direction: column; background: var(--panel); border-right: 1px solid var(--line); }
.nav-heading { min-height: 56px; display: flex; gap: 4px; align-items: center; padding-inline: 10px; border-bottom: 1px solid var(--line); }
.nav-heading strong { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .85rem; }
.nav-content { padding: 10px; overflow: auto; }
.folder-actions, .folder-edit-buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.folder-actions { justify-content: space-between; margin-bottom: 6px; }
.folder-edit { display: grid; gap: 6px; min-width: 0; padding: 8px 4px 10px; font-size: .8125rem; }
.folder-edit select { width: 100%; min-height: 28px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); color: inherit; }
.folder-edit-buttons { margin-top: 3px; justify-content: flex-end; }
.folder-error { margin: 0; color: var(--danger); }
.trash-navigation { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--line); }
.workspace-content { min-width: 0; flex: 1; display: flex; }
.workspace-message { margin: auto; text-align: center; color: var(--text-muted); }
.workspace-message button { margin-top: 10px; }
.library-info { width: min(480px, calc(100vw - 24px)); }
.library-info dl { display: grid; grid-template-columns: max-content 1fr; gap: 12px; margin: 0; }
.library-info dt { color: var(--text-muted); }
.library-info dd { margin: 0; overflow-wrap: anywhere; }
.palette-select { min-height: 28px; padding: 2px 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: var(--text); font-size: .75rem; }
@media (max-width: 590px) { .nav-heading { flex-wrap: wrap; } .nav-heading strong { flex: 1 0 100%; } }
</style>
