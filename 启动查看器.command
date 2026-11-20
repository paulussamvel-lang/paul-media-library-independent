#!/bin/zsh
set -eu

viewer_root=${0:A:h}
managed_path=${PAUL_LIBRARY_PATH:-"$HOME/Documents/Paul 素材库"}
eagle_path=${EAGLE_LIBRARY_PATH:-}
viewer_url=http://127.0.0.1:13003/
node_bin=$(command -v node || true)
[[ -n $node_bin ]] || node_bin="$HOME/.local/bin/node"

if /usr/bin/curl --noproxy '*' --max-time 1 --fail --silent "${viewer_url}api/config" | /usr/bin/grep -q '"activeLibrary"'; then
  /usr/bin/open "$viewer_url"
  exit 0
fi

if [[ ! -x $node_bin || ! -f "$viewer_root/frontend/dist/index.html" || ! -d "$viewer_root/backend/node_modules" ]]; then
  printf '查看器需要 Node.js 和已构建的本地文件。构建步骤见项目内 README.md。\n' >&2
  exit 1
fi

if [[ -z ${EAGLE_LIBRARY_PATH:-} && -r "$managed_path/library.sqlite" && -d "$managed_path/files" ]]; then
  library_path=$managed_path
  library_env=PAUL_LIBRARY_PATH
  writable=1
  mkdir -p -- "$library_path/captures"
  write_args=("--allow-fs-write=$library_path/library.sqlite" "--allow-fs-write=$library_path/library.sqlite-journal" "--allow-fs-write=$library_path/captures")
elif [[ -n "$eagle_path" && -r "$eagle_path/metadata.json" && -d "$eagle_path/images" ]]; then
  library_path=$eagle_path
  library_env=EAGLE_LIBRARY_PATH
  writable=0
  write_args=()
else
  printf '找不到素材库：%s\n' "${eagle_path:-$managed_path}" >&2
  exit 1
fi

/usr/bin/env -i "$library_env=$library_path" "PAUL_LIBRARY_WRITABLE=$writable" "$node_bin" \
  --permission --allow-net --allow-fs-read="$viewer_root" --allow-fs-read="$library_path" \
  "${write_args[@]}" \
  "$viewer_root/backend/index.js" &
viewer_pid=$!
trap 'kill "$viewer_pid" 2>/dev/null || true' EXIT
trap 'exit 0' INT TERM HUP

for attempt in {1..30}; do
  kill -0 "$viewer_pid" 2>/dev/null || { wait "$viewer_pid"; exit 1; }
  if /usr/bin/curl --noproxy '*' --max-time 1 --fail --silent "$viewer_url" >/dev/null; then
    /usr/bin/open "$viewer_url"
    break
  fi
  sleep 0.1
done

wait "$viewer_pid"
