#!/bin/zsh
set -euo pipefail
cd -- "${0:A:h}"

node_path=''
if [[ -n "${KEEPLIVE_NODE:-}" ]]; then
  candidates=("$KEEPLIVE_NODE")
else
  candidates=("${commands[node]:-}" "$HOME/.local/share/keeplive"/node-*/bin/node(NOn)
    /opt/homebrew/opt/node@24/bin/node /usr/local/opt/node@24/bin/node
    /opt/homebrew/bin/node /usr/local/bin/node)
fi
for candidate in "${candidates[@]}"; do
  if [[ -x "$candidate" ]] && "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1; then
    node_path="${candidate:a}"
    break
  fi
done
if [[ -z "$node_path" ]]; then
  print -u2 '请先安装 Node.js 24 或更高版本，或用 KEEPLIVE_NODE 指定其完整路径。'
  exit 1
fi
npm_path="${node_path:h}/npm"
if [[ ! -x "$npm_path" ]]; then
  print -u2 '所选 Node.js 缺少配套 npm，请安装完整的 Node.js 24 或更高版本。'
  exit 1
fi
export PATH="${node_path:h}:$PATH"
if "$node_path" deploy/macos/already-running.js; then
  exit 0
else
  result=$?
  if [[ "$result" -ne 1 ]]; then exit "$result"; fi
fi
if [[ ! -d node_modules ]]; then
  print '正在安装 Keeplive 所需组件…'
  "$npm_path" ci --no-audit --no-fund
fi
print '正在准备相册界面…'
"$npm_path" run build
print '请保持本窗口运行。按 Ctrl+C 停止相册。'
exec "$node_path" server/index.js
