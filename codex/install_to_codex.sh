#!/bin/bash
#
# Codex skill 安装脚本
# 用法: ./install_to_codex.sh [--skill <name>] [--all] [--local <project-path>] [--global] [--uninstall]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SKILL="huayi-dev"
SUPPORTED_SKILLS=("huayi-dev" "tabulate")

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
Codex skill 安装脚本

用法:
    ./install_to_codex.sh [选项]

选项:
    --skill <name>        选择 skill (默认: ${DEFAULT_SKILL})
    --all                 安装/卸载所有支持的 skills
    --global              安装到全局 (~/.codex/skills/)，这是默认行为
    --local <path>        安装到指定项目目录 (<path>/.codex/skills/)
    --uninstall           卸载 skill
    --deps                同时安装 Python 依赖
    -h, --help            显示此帮助信息

示例:
    ./install_to_codex.sh                          # 全局安装默认 skill
    ./install_to_codex.sh --skill tabulate         # 全局安装 tabulate
    ./install_to_codex.sh --all --global           # 全局安装所有 skills
    ./install_to_codex.sh --local /path/to/project # 安装到项目
    ./install_to_codex.sh --global --deps          # 全局安装并安装依赖
    ./install_to_codex.sh --uninstall --skill tabulate # 全局卸载 tabulate
    ./install_to_codex.sh --uninstall --all --local /path/to/project  # 从项目卸载所有 skills

EOF
}

list_supported_skills() {
    printf "%s " "${SUPPORTED_SKILLS[@]}"
}

validate_skill() {
    local skill_name="$1"

    for skill in "${SUPPORTED_SKILLS[@]}"; do
        if [ "${skill}" = "${skill_name}" ]; then
            return 0
        fi
    done

    error "不支持的 skill: ${skill_name}. 可选: $(list_supported_skills)"
}

# 安装 skill
install_skill() {
    local target_dir="$1"
    local skill_name="$2"
    local source_dir="${SCRIPT_DIR}/skills/${skill_name}"
    local skill_dir="${target_dir}/${skill_name}"
    local scripts_dir="${skill_dir}/scripts"

    if [ ! -d "${source_dir}" ]; then
        error "未找到 skill 源目录: ${source_dir}"
    fi

    info "安装目标: ${target_dir} (${skill_name})"

    # 创建目录
    mkdir -p "${skill_dir}"

    # 复制 skill 内容
    cp -R "${source_dir}/." "${skill_dir}/"
    info "已安装 skill: ${skill_dir}"

    if [ -d "${scripts_dir}" ]; then
        find "${scripts_dir}" -type f -name "*.py" -exec chmod +x {} \;
    fi

    echo ""
    info "安装完成: ${skill_name}"
    echo ""
    echo "后续步骤:"
    if [ -f "${scripts_dir}/requirements.txt" ]; then
        echo "  1. 安装 Python 依赖: pip install -r ${scripts_dir}/requirements.txt"
    else
        echo "  1. (可选) 如果需要依赖，使用 --deps 安装"
    fi
    echo "  2. 在 Codex 中使用 ${skill_name} skill"
}

# 卸载 skill
uninstall_skill() {
    local target_dir="$1"
    local skill_name="$2"
    local skill_dir="${target_dir}/${skill_name}"

    info "卸载目标: ${target_dir} (${skill_name})"

    # 删除整个 skill 目录
    if [ -d "${skill_dir}" ]; then
        rm -rf "${skill_dir}"
        info "已删除: ${skill_dir}"
    else
        warn "skill 目录不存在: ${skill_dir}"
    fi

    echo ""
    info "卸载完成!"
}

# 安装 Python 依赖
install_deps() {
    local scripts_dir="$1"
    local skill_name="$2"
    local req_file="${scripts_dir}/requirements.txt"

    if [ -f "${req_file}" ]; then
        info "安装 Python 依赖 (${skill_name})..."
        pip install -r "${req_file}"
        info "依赖安装完成!"
    else
        warn "未找到 requirements.txt (${skill_name})"
    fi
}

# 主逻辑
main() {
    local install_mode="global"
    local target_path=""
    local do_uninstall=false
    local do_deps=false
    local skill_name="${DEFAULT_SKILL}"
    local use_all=false

    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skill)
                skill_name="$2"
                if [ -z "${skill_name}" ]; then
                    error "--skill 需要指定 skill 名称"
                fi
                shift 2
                ;;
            --all)
                use_all=true
                shift
                ;;
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
        target_dir="${HOME}/.codex/skills"
    else
        if [ ! -d "${target_path}" ]; then
            error "项目目录不存在: ${target_path}"
        fi
        target_dir="${target_path}/.codex/skills"
    fi

    local skills_to_process=()
    if [ "${use_all}" = true ]; then
        skills_to_process=("${SUPPORTED_SKILLS[@]}")
    else
        validate_skill "${skill_name}"
        skills_to_process=("${skill_name}")
    fi

    # 执行操作
    for skill in "${skills_to_process[@]}"; do
        if [ "${do_uninstall}" = true ]; then
            uninstall_skill "${target_dir}" "${skill}"
        else
            install_skill "${target_dir}" "${skill}"

            if [ "${do_deps}" = true ]; then
                install_deps "${target_dir}/${skill}/scripts" "${skill}"
            fi
        fi
    done
}

main "$@"
