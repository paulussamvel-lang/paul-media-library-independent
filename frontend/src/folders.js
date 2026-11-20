export function folderOptions(tree, parent = '') {
  return tree.filter((folder) => folder.id !== '__all__').flatMap((folder) => {
    const path = parent ? `${parent} / ${folder.name}` : folder.name;
    return [{ id: folder.id, path }, ...folderOptions(folder.children || [], path)];
  });
}
