#!/usr/bin/env bash
# Install huayi-dev skills to Copilot CLI (user-level or project-level)
# Usage:
#   ./install_to_copilot.sh --global
#   ./install_to_copilot.sh --local /path/to/project

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<EOF
Usage: $0 [--global|--local <path>|--uninstall]
Installs the huayi-dev skill to Copilot CLI (creates ~/.copilot/skills/huayi-dev)
EOF
}

if [ "$#" -eq 0 ]; then
  usage
  exit 1
fi

mode=""
path=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --global)
      mode=global
      shift
      ;;
    --local)
      mode=local
      path="$2"
      shift 2
      ;;
    --uninstall)
      mode=uninstall
      shift
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

skill_src="${SCRIPT_DIR}/skills/huayi-dev"
skill_dst_global="$HOME/.copilot/skills/huayi-dev"
skill_dst_local="$path/.copilot/skills/huayi-dev"

case "$mode" in
  global)
    mkdir -p "$(dirname "$skill_dst_global")"
    cp -R "$skill_src" "$skill_dst_global"
    chmod +x "$skill_dst_global/scripts/huayi_db.py"
    echo "Installed huayi-dev skill to $skill_dst_global"
    ;;
  local)
    if [ -z "$path" ]; then
      echo "--local requires a path"
      exit 1
    fi
    mkdir -p "$(dirname "$skill_dst_local")"
    cp -R "$skill_src" "$skill_dst_local"
    chmod +x "$skill_dst_local/scripts/huayi_db.py"
    echo "Installed huayi-dev skill to $skill_dst_local"
    ;;
  uninstall)
    rm -rf "$skill_dst_global"
    echo "Uninstalled huayi-dev skill from $skill_dst_global"
    ;;
  *)
    usage
    exit 1
    ;;
esac
