#!/bin/zsh
set -eu

viewer_root=${0:A:h}
electron_bin="$viewer_root/desktop/node_modules/.bin/electron"
node_bin=$(command -v node || true)
[[ -n $node_bin ]] || node_bin="$HOME/.local/bin/node"

if [[ ! -x $electron_bin || ! -x $node_bin ]]; then
  printf '桌面版需要 Node.js 和 Electron。安装步骤见 README.md。\n' >&2
  exit 1
fi

export MEDIA_LIBRARY_NODE="$node_bin"
exec "$electron_bin" "$viewer_root/desktop"
