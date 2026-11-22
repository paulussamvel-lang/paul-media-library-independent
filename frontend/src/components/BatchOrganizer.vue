<template>
  <div class="organizer" aria-label="批量整理">
    <div class="organizer-row">
      <n-button size="small" :disabled="busy" :aria-expanded="selecting" @click="$emit('toggle')">
        {{ selecting ? '退出选择' : trash ? '选择还原' : '批量整理' }}
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
        <template v-if="!trash">
          <label class="sr-only" for="organization-action">整理操作</label>
          <select id="organization-action" v-model="action" :disabled="busy">
            <option value="add-tags">添加标签</option>
            <option value="add-to-folder">加入文件夹</option>
            <option value="move-to-folder">移动到文件夹</option>
            <option value="rename">批量改名</option>
            <option value="trash">移入回收站</option>
          </select>
        </template>
        <n-input v-if="action === 'add-tags'" v-model:value="tagText" size="small" class="organizer-value"
          :disabled="busy" placeholder="输入标签，逗号分隔" :input-props="{ 'aria-label': '标签' }" />
        <template v-if="action === 'add-to-folder' || action === 'move-to-folder'">
          <label class="sr-only" for="organization-folder">目标文件夹</label>
          <select id="organization-folder" v-model="folderId" class="organizer-value" :disabled="busy">
            <option value="" disabled>选择目标文件夹</option>
            <option v-for="folder in folderOptions" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
          </select>
        </template>
        <template v-if="action === 'rename'">
          <label class="sr-only" for="rename-mode">改名方式</label>
          <select id="rename-mode" v-model="renameMode" :disabled="busy">
            <option value="sequence">名称加编号</option>
            <option value="replace">查找替换</option>
          </select>
          <n-input v-model:value="pattern" size="small" class="organizer-value" :maxlength="160" :disabled="busy"
            :placeholder="renameMode === 'sequence' ? '输入名称，不含扩展名' : '要查找的文字'"
            :input-props="{ 'aria-label': renameMode === 'sequence' ? '新名称' : '查找文字' }" />
          <n-input v-if="renameMode === 'replace'" v-model:value="replacement" size="small" class="organizer-value"
            :maxlength="160" :disabled="busy" placeholder="留空则删除匹配文字"
            :input-props="{ 'aria-label': '替换为' }" />
        </template>
        <n-button attr-type="submit" size="small" :type="action === 'trash' ? 'warning' : 'primary'"
          :loading="busy" :disabled="!canApply">{{ actionLabel }}</n-button>
      </form>
      <p v-if="action === 'move-to-folder'" class="organizer-hint">移动会替换所选素材原有的文件夹归类。</p>
      <p v-if="action === 'rename' && renameMode === 'sequence' && ids.length > 1" class="organizer-hint">
        按当前显示顺序从 001 开始编号。
      </p>
      <p v-if="trash || action === 'trash'" class="organizer-hint">还原后，素材会回到原有的文件夹。</p>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { NButton, NInput } from 'naive-ui';
import { getOrganization, saveOrganization } from '../api/index.js';
import { folderOptions as flattenFolders } from '../folders.js';

const props = defineProps({
  selecting: Boolean,
  ids: { type: Array, required: true },
  total: { type: Number, required: true },
  folders: { type: Array, required: true },
  trash: Boolean,
});
const emit = defineEmits(['toggle', 'select-all', 'clear', 'change']);

const action = ref(props.trash ? 'restore' : 'add-tags');
const renameMode = ref('sequence');
const pattern = ref('');
const replacement = ref('');
const tagText = ref('');
const folderId = ref('');
const latest = ref(null);
const busy = ref(false);
const message = ref('');
const failed = ref(false);

const folderOptions = computed(() => flattenFolders(props.folders));
const tags = computed(() => tagText.value.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean));
const labels = { rename: '应用改名', trash: '移入回收站', restore: '还原素材' };
const outcomes = { rename: '已改名', trash: '已移入回收站', restore: '已还原' };
const actionLabel = computed(() => labels[action.value] ?? '应用');
const canApply = computed(() => {
  if (busy.value || !props.ids.length) return false;
  if (action.value === 'add-tags') return tags.value.length > 0;
  if (action.value === 'rename') return Boolean(pattern.value.trim());
  if (action.value === 'trash' || action.value === 'restore') return true;
  return Boolean(folderId.value);
});
watch(renameMode, () => { pattern.value = ''; });

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
    const outcome = outcomes[payload.action] ?? '已整理';
    message.value = operation === 'undo' ? `已撤销 ${result.updated} 项` :
      (result.updated ? `${outcome} ${result.updated} 项` : '这次操作没有更改素材');
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
  run('apply', { action: action.value, ids: props.ids, tags: tags.value, folderId: folderId.value,
    renameMode: renameMode.value, pattern: pattern.value, replacement: replacement.value });
}

function undo() {
  if (!busy.value && latest.value) run('undo', { editId: latest.value.id });
}
</script>

<style scoped>
.organizer {
  display: grid;
  gap: 7px;
  padding: 8px 16px;
  border-top: 1px solid var(--line);
  background: var(--panel);
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
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.organizer-error {
  color: var(--danger);
}

.organizer-form select {
  min-height: 28px;
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface);
}

.organizer-form select:focus-visible {
  outline: 2px solid var(--focus);
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
