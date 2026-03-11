#!/bin/bash
#
# Claude Code Skills 安装脚本
# 用法: ./install_to_claude.sh [选项]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 支持的 skills 列表
SUPPORTED_SKILLS=(
    "huayi-dev"
    "gitlab-dev"
    "playwright-cli"
    "exam-generator"
    "go-spec-review"
)

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
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

debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

# 显示帮助
show_help() {
    cat << EOF
Claude Code Skills 安装脚本

用法:
    ./install_to_claude.sh [选项]

选项:
    --skill <name>        安装指定的单个 skill
    --all                 安装所有 skills
    --list                列出所有可用的 skills
    --global              安装到全局 (~/.claude/)，这是默认行为
    --local <path>        安装到指定项目目录 (<path>/.claude/)
    --uninstall           卸载 skill（需配合 --skill 或 --all 使用）
    --deps                同时安装 Python 依赖
    --check-deps          检查 skill 依赖状态
    -h, --help            显示此帮助信息

可用的 Skills:
    huayi-dev        数据库开发助手
    gitlab-dev       GitLab 管理助手（依赖: GitLab MCP, glab CLI）
    playwright-cli   浏览器自动化（依赖: playwright-cli）
    exam-generator   试卷生成器（依赖: xelatex）
    go-spec-review   Go 规范审查

示例:
    ./install_to_claude.sh --list                      # 列出可用 skills
    ./install_to_claude.sh --skill huayi-dev          # 安装单个 skill
    ./install_to_claude.sh --all                      # 安装所有 skills
    ./install_to_claude.sh --skill huayi-dev --deps   # 安装并配置依赖
    ./install_to_claude.sh --skill gitlab-dev --check-deps  # 检查依赖
    ./install_to_claude.sh --uninstall --skill huayi-dev    # 卸载指定 skill
    ./install_to_claude.sh --uninstall --all          # 卸载所有 skills

EOF
}

# 列出可用的 skills
list_skills() {
    echo ""
    echo "可用的 Skills:"
    echo "=============="
    echo ""

    for skill in "${SUPPORTED_SKILLS[@]}"; do
        local skill_dir="${SCRIPT_DIR}/skills/${skill}"
        local description=""

        # 尝试从 manifest.yaml 或 skill.md 获取描述
        if [ -f "${skill_dir}/manifest.yaml" ]; then
            description=$(grep -A1 "^description:" "${skill_dir}/manifest.yaml" 2>/dev/null | head -2 | tail -1 | sed 's/^[ ]*//')
        elif [ -f "${skill_dir}/skill.md" ]; then
            description=$(grep "^description:" "${skill_dir}/skill.md" 2>/dev/null | head -1 | sed 's/^description: *//')
        fi

        if [ -d "${skill_dir}" ]; then
            printf "  %-18s %s\n" "${skill}" "${description:0:60}"
        else
            printf "  %-18s %s\n" "${skill}" "(未找到)"
        fi
    done

    echo ""
}

# 检查 skill 依赖
check_skill_deps() {
    local skill_name="$1"

    echo ""
    info "检查 ${skill_name} 的依赖..."
    echo ""

    case "$skill_name" in
        "gitlab-dev")
            echo "GitLab MCP:"
            if [ -f "${HOME}/.claude/mcp-settings.json" ]; then
                if grep -q '"gitlab"' "${HOME}/.claude/mcp-settings.json" 2>/dev/null; then
                    echo "  [OK] GitLab MCP 已配置"
                else
                    echo "  [MISSING] GitLab MCP 未配置"
                    echo "  安装: 在 ~/.claude/mcp-settings.json 中添加 gitlab MCP 配置"
                fi
            else
                echo "  [MISSING] mcp-settings.json 不存在"
            fi

            echo ""
            echo "glab CLI:"
            if command -v glab &> /dev/null; then
                echo "  [OK] glab 已安装: $(glab --version 2>&1 | head -1)"
                if glab auth status &> /dev/null; then
                    echo "  [OK] glab 已认证"
                else
                    echo "  [WARN] glab 未认证，请运行: glab auth login"
                fi
            else
                echo "  [MISSING] glab 未安装"
                echo "  安装: brew install glab (macOS) 或 apt install glab (Linux)"
            fi
            ;;

        "playwright-cli")
            echo "playwright-cli:"
            if command -v playwright-cli &> /dev/null; then
                echo "  [OK] playwright-cli 已安装"
            else
                echo "  [MISSING] playwright-cli 未安装"
                echo "  安装: npm install -g @anthropic/playwright-cli"
            fi
            ;;

        "exam-generator")
            echo "xelatex:"
            if command -v xelatex &> /dev/null; then
                echo "  [OK] xelatex 已安装: $(xelatex --version 2>&1 | head -1)"
            else
                echo "  [MISSING] xelatex 未安装"
                echo "  安装: brew install --cask mactex (macOS)"
                echo "        apt install texlive-xetex (Linux)"
            fi
            ;;

        "huayi-dev")
            echo "Python:"
            if command -v python3 &> /dev/null; then
                echo "  [OK] python3 已安装: $(python3 --version)"
            else
                echo "  [MISSING] python3 未安装"
            fi

            echo ""
            echo "pip:"
            if command -v pip3 &> /dev/null || command -v pip &> /dev/null; then
                echo "  [OK] pip 已安装"
            else
                echo "  [MISSING] pip 未安装"
            fi
            ;;

        "go-spec-review")
            echo "Go:"
            if command -v go &> /dev/null; then
                echo "  [OK] go 已安装: $(go version)"
            else
                echo "  [WARN] go 未安装（运行脚本需要）"
            fi
            ;;

        *)
            echo "  无特殊依赖"
            ;;
    esac

    echo ""
}

# 安装单个 skill
install_single_skill() {
    local skill_name="$1"
    local target_dir="$2"
    local skills_dir="${target_dir}/skills/${skill_name}"

    local source_dir="${SCRIPT_DIR}/skills/${skill_name}"

    if [ ! -d "${source_dir}" ]; then
        error "Skill 不存在: ${skill_name}"
    fi

    info "安装 ${skill_name} 到 ${skills_dir}"

    # 创建目录
    mkdir -p "${skills_dir}"

    # 复制所有文件
    cp -r "${source_dir}/"* "${skills_dir}/" 2>/dev/null || true

    # 设置脚本可执行权限
    if [ -d "${skills_dir}/scripts" ]; then
        find "${skills_dir}/scripts" -type f \( -name "*.py" -o -name "*.sh" \) -exec chmod +x {} \;
    fi

    info "已安装: ${skill_name}"
}

# 卸载单个 skill
uninstall_single_skill() {
    local skill_name="$1"
    local target_dir="$2"
    local skills_dir="${target_dir}/skills/${skill_name}"

    if [ -d "${skills_dir}" ]; then
        rm -rf "${skills_dir}"
        info "已卸载: ${skill_name}"
    else
        warn "Skill 未安装: ${skill_name}"
    fi
}

# 安装 Python 依赖
install_deps() {
    local skill_name="$1"
    local target_dir="$2"
    local skills_dir="${target_dir}/skills/${skill_name}"
    local req_file="${skills_dir}/scripts/requirements.txt"

    if [ -f "${req_file}" ]; then
        info "安装 ${skill_name} 的 Python 依赖..."
        pip install -r "${req_file}"
        info "依赖安装完成!"
    else
        # 尝试其他位置
        req_file="${skills_dir}/requirements.txt"
        if [ -f "${req_file}" ]; then
            info "安装 ${skill_name} 的 Python 依赖..."
            pip install -r "${req_file}"
            info "依赖安装完成!"
        fi
    fi
}

# 主逻辑
main() {
    local install_mode="global"
    local target_path=""
    local do_uninstall=false
    local do_deps=false
    local do_check_deps=false
    local do_list=false
    local do_all=false
    local selected_skill=""

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
            --skill)
                selected_skill="$2"
                if [ -z "${selected_skill}" ]; then
                    error "--skill 需要指定 skill 名称"
                fi
                shift 2
                ;;
            --all)
                do_all=true
                shift
                ;;
            --list)
                do_list=true
                shift
                ;;
            --uninstall)
                do_uninstall=true
                shift
                ;;
            --deps)
                do_deps=true
                shift
                ;;
            --check-deps)
                do_check_deps=true
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

    # 处理列表命令
    if [ "${do_list}" = true ]; then
        list_skills
        exit 0
    fi

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

    # 检查依赖
    if [ "${do_check_deps}" = true ]; then
        if [ -n "${selected_skill}" ]; then
            check_skill_deps "${selected_skill}"
        elif [ "${do_all}" = true ]; then
            for skill in "${SUPPORTED_SKILLS[@]}"; do
                check_skill_deps "${skill}"
            done
        else
            error "请使用 --skill <name> 或 --all 指定要检查的 skill"
        fi
        exit 0
    fi

    # 验证是否指定了 skill
    if [ -z "${selected_skill}" ] && [ "${do_all}" = false ]; then
        warn "未指定 skill，默认安装 huayi-dev"
        selected_skill="huayi-dev"
    fi

    # 执行操作
    if [ "${do_uninstall}" = true ]; then
        if [ "${do_all}" = true ]; then
            for skill in "${SUPPORTED_SKILLS[@]}"; do
                uninstall_single_skill "${skill}" "${target_dir}"
            done
        else
            uninstall_single_skill "${selected_skill}" "${target_dir}"
        fi
        echo ""
        info "卸载完成!"
    else
        if [ "${do_all}" = true ]; then
            for skill in "${SUPPORTED_SKILLS[@]}"; do
                local source_dir="${SCRIPT_DIR}/skills/${skill}"
                if [ -d "${source_dir}" ]; then
                    install_single_skill "${skill}" "${target_dir}"
                    if [ "${do_deps}" = true ]; then
                        install_deps "${skill}" "${target_dir}"
                    fi
                fi
            done
        else
            install_single_skill "${selected_skill}" "${target_dir}"
            if [ "${do_deps}" = true ]; then
                install_deps "${selected_skill}" "${target_dir}"
            fi
        fi

        echo ""
        info "安装完成!"
        echo ""
        echo "后续步骤:"
        echo "  1. 检查依赖: ./install_to_claude.sh --check-deps --skill <name>"
        echo "  2. 在 Claude Code 中使用: /<skill-name>"
    fi
}

main "$@"
