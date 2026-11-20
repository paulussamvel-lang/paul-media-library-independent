<template>
  <section class="smart-folders" aria-label="智能文件夹">
    <header class="smart-header">
      <h2>智能文件夹</h2>
      <n-button v-if="canEdit" size="tiny" quaternary aria-label="新建智能文件夹" @click="openEditor()">新建</n-button>
    </header>
    <p v-if="loadError" class="smart-muted" role="status">{{ loadError }}</p>
    <ul v-if="rules.length" class="smart-list">
      <li v-for="rule in rules" :key="rule.id" class="smart-item">
        <button type="button" class="smart-link" :aria-current="rule.id === selectedId ? 'true' : undefined"
          :title="rule.name" @click="select(rule)">{{ rule.name }}</button>
        <n-button v-if="canEdit" size="tiny" quaternary :aria-label="`编辑 ${rule.name}`" @click="openEditor(rule)">编辑</n-button>
      </li>
    </ul>

    <n-modal v-model:show="showEditor" preset="card" :title="editingId ? '编辑智能文件夹' : '新建智能文件夹'"
      class="smart-modal" :mask-closable="false" :closable="!busy" :close-on-esc="!busy">
      <form class="smart-form" @submit.prevent="save">
        <div class="smart-field">
          <label for="smart-name">名称</label>
          <n-input v-model:value="form.name" :maxlength="60" :input-props="{ id: 'smart-name' }" :disabled="busy" />
        </div>
        <div class="smart-field">
          <label for="smart-scope">范围</label>
          <select id="smart-scope" v-model="form.scope" :disabled="busy">
            <option value="">全部素材</option>
            <option v-for="folder in options" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
          </select>
          <label v-if="form.scope" class="scope-checkbox">
            <input type="checkbox" v-model="form.includeChildren" :disabled="busy" /> 包含子文件夹
          </label>
        </div>
        <div class="smart-field">
          <label for="smart-keyword">关键词</label>
          <n-input v-model:value="form.keyword" :maxlength="160" placeholder="文件名、标签或备注"
            :input-props="{ id: 'smart-keyword' }" :disabled="busy" />
        </div>
        <div class="smart-rule-row">
          <div class="smart-field">
            <label for="smart-tag">标签</label>
            <n-input v-model:value="form.tag" :maxlength="80" placeholder="完整标签名"
              :input-props="{ id: 'smart-tag' }" :disabled="busy" />
          </div>
          <div class="smart-field">
            <label for="smart-extension">格式</label>
            <n-input v-model:value="form.extension" :maxlength="16" placeholder="例如 mp3"
              :input-props="{ id: 'smart-extension' }" :disabled="busy" />
          </div>
          <div class="smart-field">
            <label for="smart-rating">最低评分</label>
            <select id="smart-rating" v-model.number="form.minimumRating" :disabled="busy">
              <option :value="0">不限</option>
              <option v-for="stars in 5" :key="stars" :value="stars">{{ stars }} 星</option>
            </select>
          </div>
        </div>
        <p v-if="error" class="smart-error" role="status">{{ error }}</p>
        <footer class="smart-actions">
          <n-button v-if="editingId && !confirmRemove" quaternary :disabled="busy" @click="confirmRemove = true">移除规则</n-button>
          <n-button v-if="confirmRemove" quaternary type="error" :disabled="busy" @click="remove">确认移除规则</n-button>
          <div class="smart-spacer"></div>
          <n-button :disabled="busy" @click="showEditor = false">取消</n-button>
          <n-button attr-type="submit" type="primary" :loading="busy" :disabled="!form.name?.trim()">保存</n-button>
        </footer>
      </form>
    </n-modal>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { NButton, NInput, NModal } from 'naive-ui';
import { getSmartFolders, saveSmartFolder } from '../api/index.js';
import { folderOptions } from '../folders.js';

const props = defineProps({
  folders: { type: Array, required: true },
  selectedId: { type: String, default: '' },
  canEdit: Boolean,
});
const emit = defineEmits(['select', 'removed']);
const rules = ref([]);
const loadError = ref('');
const showEditor = ref(false);
const busy = ref(false);
const error = ref('');
const confirmRemove = ref(false);
const form = ref({});
const editingId = computed(() => form.value.id);
const options = computed(() => folderOptions(props.folders));

onMounted(async () => {
  try {
    rules.value = await getSmartFolders();
  } catch (error) {
    loadError.value = error.message;
  }
});

function select(rule) {
  emit('select', { ...rule, kind: 'smart' });
}

function openEditor(rule) {
  form.value = rule ? { ...rule, scope: rule.scope ?? '', includeChildren: Boolean(rule.includeChildren) } : {
    name: '', scope: options.value.some((option) => option.id === props.selectedId) ? props.selectedId : '',
    includeChildren: false, keyword: '', tag: '', extension: '', minimumRating: 0,
  };
  error.value = '';
  confirmRemove.value = false;
  showEditor.value = true;
}

async function change(operation, payload) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const rule = await saveSmartFolder(operation, payload);
    rules.value = rules.value.filter(({ id }) => id !== rule.id);
    if (operation === 'remove') {
      emit('removed', rule.id);
    } else {
      rules.value = [...rules.value, rule].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
      select(rule);
    }
    showEditor.value = false;
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

function save() {
  change('save', { ...form.value, scope: form.value.scope || null });
}

function remove() {
  change('remove', { id: editingId.value, version: form.value.version });
}
</script>

<style scoped>
.smart-folders { margin-top: 14px; padding: 8px 4px 0; border-top: 1px solid #303039; }
.smart-header, .smart-item, .smart-actions { display: flex; align-items: center; gap: 8px; }
.smart-header { justify-content: space-between; }
.smart-header h2, .smart-muted { color: #b6b6c4; font-size: 0.75rem; font-weight: 600; }
.smart-header h2 { padding-left: 6px; }
.smart-list { display: grid; gap: 2px; margin: 5px 0 0; padding: 0; list-style: none; }
.smart-link {
  flex: 1; min-width: 0; padding: 4px 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  text-align: left; color: #e6e6ed; border: 0; border-radius: 4px; background: transparent; cursor: pointer;
}
.smart-link:hover { background: #30303c; }
.smart-link[aria-current='true'] { background: #283c38; color: #c3eed8; }
.smart-link:focus-visible, .smart-field select:focus-visible { outline: 2px solid #a5bfff; outline-offset: 1px; }
.smart-modal { width: min(515px, calc(100vw - 24px)); }
.smart-form, .smart-field { display: grid; gap: 6px; }
.smart-form { gap: 12px; }
.smart-field { min-width: 0; color: #c6c6d0; font-size: 0.8125rem; }
.smart-field select { width: 100%; min-height: 34px; padding: 4px 7px; border: 1px solid #484854; border-radius: 4px; color: #e6e6ed; background: #222229; color-scheme: dark; }
.scope-checkbox { display: flex; align-items: center; gap: 6px; }
.smart-rule-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(120px, 100%), 1fr)); gap: 9px; }
.smart-error { margin: 0; color: #ffb5ab; }
.smart-actions { flex-wrap: wrap; }
.smart-spacer { flex: 1; }
</style>
