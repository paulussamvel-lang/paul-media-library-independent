<template>
  <div class="organizer" aria-label="批量整理">
    <div class="organizer-row">
      <n-button size="small" :disabled="busy" :aria-expanded="selecting" @click="$emit('toggle')">
        {{ selecting ? '退出选择' : '批量整理' }}
      </n-button>
      <n-button v-if="latest" size="small" secondary :disabled="busy" @click="undo">撤销上次整理</n-button>
      <span v-if="message" class="organizer-message" :class="{ 'organizer-error': failed }" role="status">{{ message }}</span>
    </div>

    <template v-if="selecting">
      <div class="organizer-row organizer-selection">
        <span>已选 {{ ids.length }} 项</span>
        <n-button size="tiny" quaternary :disabled="!total || busy" @click="$emit('select-all')">全选当前结果</n-button>
        <n-button v-if="ids.length" size="tiny" quaternary :disabled="busy" @click="$emit('clear')">清空选择</n-button>
      </div>
      <form class="organizer-row organizer-form" @submit.prevent="apply">
        <label class="sr-only" for="organization-action">整理操作</label>
        <select id="organization-action" v-model="action" :disabled="busy">
          <option value="add-tags">添加标签</option>
          <option value="add-to-folder">加入文件夹</option>
          <option value="move-to-folder">移动到文件夹</option>
        </select>
        <n-input v-if="action === 'add-tags'" v-model:value="tagText" size="small" class="organizer-value"
          :disabled="busy" placeholder="输入标签，逗号分隔" :input-props="{ 'aria-label': '标签' }" />
        <template v-else>
          <label class="sr-only" for="organization-folder">目标文件夹</label>
          <select id="organization-folder" v-model="folderId" class="organizer-value" :disabled="busy">
            <option value="" disabled>选择目标文件夹</option>
            <option v-for="folder in folderOptions" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
          </select>
        </template>
        <n-button attr-type="submit" size="small" type="primary" :loading="busy" :disabled="!canApply">应用</n-button>
      </form>
      <p v-if="action === 'move-to-folder'" class="organizer-hint">移动会替换所选素材原有的文件夹归类。</p>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { NButton, NInput } from 'naive-ui';
import { getOrganization, saveOrganization } from '../api/index.js';
import { folderOptions as flattenFolders } from '../folders.js';

const props = defineProps({
  selecting: Boolean,
  ids: { type: Array, required: true },
  total: { type: Number, required: true },
  folders: { type: Array, required: true },
});
const emit = defineEmits(['toggle', 'select-all', 'clear', 'change']);

const action = ref('add-tags');
const tagText = ref('');
const folderId = ref('');
const latest = ref(null);
const busy = ref(false);
const message = ref('');
const failed = ref(false);

const folderOptions = computed(() => flattenFolders(props.folders));
const tags = computed(() => tagText.value.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean));
const canApply = computed(() => !busy.value && props.ids.length > 0 &&
  (action.value === 'add-tags' ? tags.value.length > 0 : Boolean(folderId.value)));

async function refreshHistory() {
  latest.value = (await getOrganization()).latestEdit;
}

onMounted(() => {
  refreshHistory().catch((error) => {
    failed.value = true;
    message.value = error.message;
  });
});

async function run(operation, payload) {
  busy.value = true;
  failed.value = false;
  message.value = '';
  try {
    const result = await saveOrganization(operation, payload);
    latest.value = result.latestEdit;
    message.value = operation === 'undo' ? `已撤销 ${result.updated} 项` :
      (result.updated ? `已整理 ${result.updated} 项` : '所选素材已符合这项整理操作');
    if (result.updated) emit('change');
  } catch (error) {
    failed.value = true;
    message.value = error.message;
    await refreshHistory().catch(() => {});
  } finally {
    busy.value = false;
  }
}

function apply() {
  if (!canApply.value) return;
  run('apply', { action: action.value, ids: props.ids, tags: tags.value, folderId: folderId.value });
}

function undo() {
  if (!busy.value && latest.value) run('undo', { editId: latest.value.id });
}
</script>

<style scoped>
.organizer {
  display: grid;
  gap: 7px;
  padding: 0 20px 9px;
  border-bottom: 1px solid #2a2a35;
}

.organizer-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.organizer-selection,
.organizer-message,
.organizer-hint,
.organizer-form select {
  color: #c6c6d0;
  font-size: 0.8125rem;
}

.organizer-error {
  color: #ffb5ab;
}

.organizer-form select {
  min-height: 28px;
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid #484854;
  border-radius: 4px;
  background: #222229;
  color-scheme: dark;
}

.organizer-form select:focus-visible {
  outline: 2px solid #a5bfff;
  outline-offset: 2px;
}

.organizer-value {
  flex: 1 1 160px;
  min-width: 0;
}

.organizer-hint {
  margin: 0;
}
</style>
