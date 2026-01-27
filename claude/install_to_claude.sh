#!/bin/bash
#
# huayi-dev skill 安装脚本
# 用法: ./install_to_claude.sh [--local <project-path>] [--global] [--uninstall]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_NAME="huayi-dev"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# 显示帮助
show_help() {
    cat << EOF
huayi-dev skill 安装脚本

用法:
    ./install_to_claude.sh [选项]

选项:
    --global              安装到全局 (~/.claude/)，这是默认行为
    --local <path>        安装到指定项目目录 (<path>/.claude/)
    --uninstall           卸载 skill
    --deps                同时安装 Python 依赖
    -h, --help            显示此帮助信息

示例:
    ./install_to_claude.sh                      # 全局安装
    ./install_to_claude.sh --global             # 全局安装
    ./install_to_claude.sh --local /path/to/project  # 安装到项目
    ./install_to_claude.sh --global --deps      # 全局安装并安装依赖
    ./install_to_claude.sh --uninstall          # 全局卸载
    ./install_to_claude.sh --uninstall --local /path/to/project  # 从项目卸载

EOF
}

# 安装 skill
install_skill() {
    local target_dir="$1"
    local commands_dir="${target_dir}/commands"
    local scripts_dir="${target_dir}/scripts"

    info "安装目标: ${target_dir}"

    # 创建目录
    mkdir -p "${commands_dir}"
    mkdir -p "${scripts_dir}"

    # 复制 skill 文件
    cp "${SCRIPT_DIR}/skills/${SKILL_NAME}/${SKILL_NAME}.md" "${commands_dir}/"
    info "已安装 command: ${commands_dir}/${SKILL_NAME}.md"

    # 复制脚本文件
    cp "${SCRIPT_DIR}/skills/${SKILL_NAME}/scripts/huayi_db.py" "${scripts_dir}/"
    chmod +x "${scripts_dir}/huayi_db.py"
    info "已安装脚本: ${scripts_dir}/huayi_db.py"

    # 复制依赖文件
    cp "${SCRIPT_DIR}/skills/${SKILL_NAME}/scripts/requirements.txt" "${scripts_dir}/"
    info "已安装依赖清单: ${scripts_dir}/requirements.txt"

    echo ""
    info "安装完成!"
    echo ""
    echo "后续步骤:"
    echo "  1. 安装 Python 依赖: pip install -r ${scripts_dir}/requirements.txt"
    echo "  2. 创建数据库配置文件 (参考 README.md)"
    echo "  3. 在 Claude Code 中使用: /huayi-dev --database-config <config.yaml>"
}

# 卸载 skill
uninstall_skill() {
    local target_dir="$1"
    local commands_dir="${target_dir}/commands"
    local scripts_dir="${target_dir}/scripts"

    info "卸载目标: ${target_dir}"

    # 删除 command 文件
    if [ -f "${commands_dir}/${SKILL_NAME}.md" ]; then
        rm "${commands_dir}/${SKILL_NAME}.md"
        info "已删除: ${commands_dir}/${SKILL_NAME}.md"
    fi

    # 删除脚本文件
    if [ -f "${scripts_dir}/huayi_db.py" ]; then
        rm "${scripts_dir}/huayi_db.py"
        info "已删除: ${scripts_dir}/huayi_db.py"
    fi

    # 删除依赖文件 (可选，因为可能被其他 skill 使用)
    if [ -f "${scripts_dir}/requirements.txt" ]; then
        warn "保留 requirements.txt (可能被其他 skill 使用)"
    fi

    echo ""
    info "卸载完成!"
}

# 安装 Python 依赖
install_deps() {
    local scripts_dir="$1"
    local req_file="${scripts_dir}/requirements.txt"

    if [ -f "${req_file}" ]; then
        info "安装 Python 依赖..."
        pip install -r "${req_file}"
        info "依赖安装完成!"
    else
        warn "未找到 requirements.txt"
    fi
}

# 主逻辑
main() {
    local install_mode="global"
    local target_path=""
    local do_uninstall=false
    local do_deps=false

    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --global)
                install_mode="global"
                shift
                ;;
            --local)
                install_mode="local"
                target_path="$2"
                if [ -z "${target_path}" ]; then
                    error "--local 需要指定项目路径"
                fi
                shift 2
                ;;
            --uninstall)
                do_uninstall=true
                shift
                ;;
            --deps)
                do_deps=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                error "未知选项: $1"
                ;;
        esac
    done

    # 确定目标目录
    local target_dir
    if [ "${install_mode}" = "global" ]; then
        target_dir="${HOME}/.claude"
    else
        if [ ! -d "${target_path}" ]; then
            error "项目目录不存在: ${target_path}"
        fi
        target_dir="${target_path}/.claude"
    fi

    # 执行操作
    if [ "${do_uninstall}" = true ]; then
        uninstall_skill "${target_dir}"
    else
        install_skill "${target_dir}"

        if [ "${do_deps}" = true ]; then
            install_deps "${target_dir}/scripts"
        fi
    fi
}

main "$@"
