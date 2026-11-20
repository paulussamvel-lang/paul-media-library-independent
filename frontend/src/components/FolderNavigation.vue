<template>
  <ul class="folder-branches">
    <li v-for="folder in folders" :key="folder.id">
      <div class="folder-line">
        <button v-if="folder.children?.length" type="button" class="disclosure"
          :aria-label="`${open.has(folder.id) ? '收起' : '展开'} ${folder.name}`"
          :aria-expanded="open.has(folder.id)" @click="toggle(folder.id)">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" :class="{ down: open.has(folder.id) }">
            <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.3"/>
          </svg>
        </button>
        <button type="button" class="folder-choice" :aria-current="folder.id === active ? 'page' : undefined"
          :title="folder.name" @click="$emit('choose', folder)">
          {{ folder.name }}
        </button>
      </div>
      <FolderNavigation v-if="folder.children?.length && open.has(folder.id)" :folders="folder.children"
        :active="active" @choose="$emit('choose', $event)" />
    </li>
  </ul>
</template>

<script setup>
import { reactive, watch } from 'vue';
defineOptions({ name: 'FolderNavigation' });
const props = defineProps({ folders: { type: Array, required: true }, active: String });
defineEmits(['choose']);
const open = reactive(new Set());
const contains = (branches, id) => branches.some(folder =>
  folder.id === id || (folder.children?.length && contains(folder.children, id)));
watch(() => [props.active, props.folders], ([id, folders]) => {
  for (const folder of folders) {
    if (folder.children?.length && contains(folder.children, id)) open.add(folder.id);
  }
}, { immediate: true });
function toggle(id) {
  if (open.has(id)) open.delete(id);
  else open.add(id);
}
</script>

<style scoped>
.folder-branches { margin: 0; padding: 0; list-style: none; }
.folder-branches .folder-branches { margin-left: 15px; }
.folder-line { display: flex; min-width: 0; align-items: center; margin: 2px 0; }
.disclosure, .folder-choice { border: 0; background: transparent; color: inherit; cursor: pointer; }
.disclosure { display: grid; width: 26px; min-height: 30px; place-items: center; color: var(--text-muted); }
.disclosure .down { transform: rotate(90deg); }
.folder-choice {
  min-width: 0; flex: 1; text-align: left; border-radius: 5px; padding: 7px 9px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.folder-choice:hover { background: #2a3341; }
.folder-choice[aria-current='page'] { background: #2b424a; color: #daf5fa; }
</style>
