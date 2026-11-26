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
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true">
            <path v-if="folder.id === '__all__'" d="M3 3h5.5v5.5H3zM11.5 3H17v5.5h-5.5zM3 11.5h5.5V17H3zM11.5 11.5H17V17h-5.5z"/>
            <path v-else-if="folder.id === '__trash__'" d="M3.5 5.5h13M7.5 5.5v-2h5v2m-8 0 1 11h9l1-11M8 8v6m4-6v6"/>
            <path v-else d="M2.5 6V4.5h5l2 2h8v9.8h-15V6Z"/>
          </svg>
          <span>{{ folder.name }}</span>
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
  display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1; text-align: left; border-radius: 5px; padding: 7px 9px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.folder-choice svg { flex: none; color: var(--text-muted); }
.folder-choice[aria-current] svg { color: inherit; }
.folder-choice span { overflow: hidden; text-overflow: ellipsis; }
.folder-choice:hover { background: var(--hover); }
.folder-choice[aria-current='page'] { background: var(--selected); color: var(--accent); font-weight: 600; }
</style>
