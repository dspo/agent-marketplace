# GitLab 开发助手

GitLab 项目管理和 CI/CD 开发专家。结合 GitLab MCP 和 glab CLI 操作 GitLab。

## 触发场景

用户提到以下关键词时使用此 skill：
- gitlab、glab、merge request、MR、issue
- CI/CD、pipeline、.gitlab-ci.yml
- container registry、镜像构建

## 依赖检查

使用此 skill 前，请确保已安装以下依赖。

### 初次使用检查命令

```bash
# 检查 GitLab MCP 是否可用
# 如果当前会话中有 mcp__gitlab__ 开头的工具，说明 MCP 已配置

# 检查 glab CLI 是否安装
which glab || echo "glab 未安装"

# 检查 glab 是否已认证
glab auth status 2>/dev/null || echo "glab 未认证"
```

### GitLab MCP 配置

GitLab MCP 通过 Claude Code 的 MCP 配置文件管理。配置位置：`~/.claude/mcp-settings.json`

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@anthropic/gitlab-mcp"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "<your-token>",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      }
    }
  }
}
```

如需配置私有 GitLab 实例，修改 `GITLAB_API_URL` 为你的 GitLab API 地址。

### glab CLI 安装

| 平台 | 安装命令 |
|------|---------|
| macOS | `brew install glab` |
| Linux (apt) | `apt install glab` |
| Linux (snap) | `snap install glab` |
| Windows | `winget install glab` |

安装后配置认证：

```bash
# 使用 PAT 登录（推荐）
glab auth login --token <PAT> --hostname <gitlab-host>

# 或设置环境变量
export GITLAB_TOKEN=<PAT>
export GITLAB_HOST=<gitlab-host>
```

### 环境变量

| 变量 | 用途 | 必需 |
|------|-----|------|
| GITLAB_TOKEN | GitLab Personal Access Token | 否（优先用 MCP） |
| GITLAB_HOST | GitLab 实例地址 | 否（默认 gitlab.com） |

## 工具选择策略

**原则：MCP 优先，glab CLI 补充**

### GitLab MCP 工具（优先使用）

MCP 工具通过 Claude Code 内置支持，无需额外认证步骤（已在 mcp-settings.json 配置）。

#### 读取操作

| 操作 | MCP 工具 | 说明 |
|------|---------|------|
| 获取 Issue 详情 | `mcp__gitlab__get_issue` | `id`: 项目路径, `issue_iid`: Issue 编号 |
| 获取 MR 详情 | `mcp__gitlab__get_merge_request` | `id`: 项目路径, `merge_request_iid`: MR 编号 |
| 获取 MR 差异 | `mcp__gitlab__get_merge_request_diffs` | 查看代码变更 |
| 获取 MR 提交 | `mcp__gitlab__get_merge_request_commits` | 查看提交历史 |
| 获取 MR Pipeline | `mcp__gitlab__get_merge_request_pipelines` | 查看 CI 状态 |
| 获取 Pipeline Jobs | `mcp__gitlab__get_pipeline_jobs` | 查看具体任务 |
| 获取评论 | `mcp__gitlab__get_workitem_notes` | 获取 Issue/MR 评论 |
| 搜索 | `mcp__gitlab__search` | 搜索 Issues、MRs、代码等 |

#### 写入操作

| 操作 | MCP 工具 | 说明 |
|------|---------|------|
| 创建 Issue | `mcp__gitlab__create_issue` | 创建新 Issue |
| 创建 MR | `mcp__gitlab__create_merge_request` | 创建 Merge Request |
| 创建评论 | `mcp__gitlab__create_workitem_note` | 在 Issue/MR 上添加评论 |

### glab CLI（MCP 不支持时使用）

以下操作 MCP 不支持，需要使用 glab CLI：

| 操作类别 | glab 命令 | 说明 |
|---------|----------|------|
| **MR 状态变更** | `glab mr merge <iid>` | 合并 MR |
| | `glab mr close <iid>` | 关闭 MR |
| | `glab mr reopen <iid>` | 重新打开 MR |
| | `glab mr approve <iid>` | 批准 MR |
| | `glab mr revoke <iid>` | 撤销批准 |
| **MR 更新** | `glab mr update <iid> --title "..."` | 更新 MR 标题 |
| | `glab mr update <iid> --description "..."` | 更新 MR 描述 |
| | `glab mr update <iid> --assignee @user` | 设置负责人 |
| **Issue 状态变更** | `glab issue close <iid>` | 关闭 Issue |
| | `glab issue reopen <iid>` | 重新打开 Issue |
| **Issue 更新** | `glab issue update <iid> --title "..."` | 更新 Issue |
| **Pipeline 操作** | `glab pipeline run` | 触发 Pipeline |
| | `glab pipeline cancel <id>` | 取消 Pipeline |
| | `glab pipeline retry <id>` | 重试 Pipeline |
| | `glab ci lint` | 验证 .gitlab-ci.yml |
| **仓库操作** | `glab repo clone <project>` | 克隆仓库 |
| | `glab repo view` | 查看仓库信息 |

## 工作流程示例

### 1. 查看 Issue 并创建 MR

```
# 1. 用 MCP 获取 Issue 详情
mcp__gitlab__get_issue(id="group/project", issue_iid=1)

# 2. 创建分支并修改代码
git checkout -b feature/xxx

# 3. 提交并推送
git add . && git commit -m "feat: xxx" && git push -u origin feature/xxx

# 4. 用 MCP 创建 MR
mcp__gitlab__create_merge_request(
    id="group/project",
    title="feat: xxx",
    source_branch="feature/xxx",
    target_branch="main",
    description="Closes #1"
)
```

### 2. Review MR 并合并

```
# 1. 用 MCP 获取 MR 详情和 diff
mcp__gitlab__get_merge_request(id="group/project", merge_request_iid=1)
mcp__gitlab__get_merge_request_diffs(id="group/project", merge_request_iid=1)

# 2. 用 MCP 添加评论
mcp__gitlab__create_workitem_note(
    project_id="group/project",
    work_item_iid=1,
    body="LGTM!"
)

# 3. 用 glab 合并（MCP 不支持）
glab mr merge 1
```

### 3. 更新 MR 属性

```bash
# MCP 不支持更新 MR，使用 glab
glab mr update <iid> --description "new description"
glab mr update <iid> --title "new title"
glab mr update <iid> --assignee @username
```

### 4. 搜索和查询

```
# 搜索 Issues
mcp__gitlab__search(scope="issues", search="bug", project_id="group/project")

# 搜索 MRs
mcp__gitlab__search(scope="merge_requests", search="feature", project_id="group/project")

# 搜索代码
mcp__gitlab__search(scope="blobs", search="function_name", project_id="group/project")
```

## .gitlab-ci.yml 最佳实践

### Docker 镜像构建

```yaml
stages:
  - build

build-image:
  stage: build
  image: docker:24-dind
  services:
    - docker:24-dind
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
    REGISTRY: registry.example.com
    IMAGE_NAME: group/project
  rules:
    - if: '$CI_COMMIT_BRANCH == "master"'
    - when: manual
      allow_failure: true
  before_script:
    - docker login -u gitlab-ci-token -p "$CI_JOB_TOKEN" "$REGISTRY"
  script:
    - |
      if [ -n "$CI_COMMIT_TAG" ]; then
        IMAGE_TAG="$CI_COMMIT_TAG"
      elif echo "$CI_COMMIT_REF_NAME" | grep -qE '^release/'; then
        IMAGE_TAG="v${CI_COMMIT_REF_NAME#release/}"
      else
        IMAGE_TAG="dev"
      fi
      docker build -t "$REGISTRY/$IMAGE_NAME:$IMAGE_TAG" -f Dockerfile .
      docker push "$REGISTRY/$IMAGE_NAME:$IMAGE_TAG"
  after_script:
    - docker logout "$REGISTRY" || true
```

### 常用 CI 变量

| 变量 | 说明 |
|------|------|
| `CI_COMMIT_BRANCH` | 当前分支名 |
| `CI_COMMIT_TAG` | 当前 tag 名（仅 tag 触发时有值） |
| `CI_COMMIT_REF_NAME` | 分支或 tag 名 |
| `CI_COMMIT_SHA` | 完整 commit SHA |
| `CI_COMMIT_SHORT_SHA` | 短 commit SHA |
| `CI_JOB_TOKEN` | Job 临时 token（用于 Registry 登录） |
| `CI_PIPELINE_SOURCE` | 触发来源（push/merge_request_event/web/api） |
| `CI_PROJECT_PATH` | 项目路径（group/project） |

## 注意事项

1. **工具选择顺序**：优先使用 MCP 工具（已配置则无需额外认证），MCP 不支持的操作再用 glab CLI
2. **glab 认证**：使用 PAT 登录，需要 `api` 权限
3. **CI 中的认证**：使用 `CI_JOB_TOKEN` 登录 Container Registry，无需额外配置
4. **项目 ID 格式**：MCP 工具的 `id` 参数使用 URL 编码路径（如 `group/project`）
5. **URL 支持**：部分 MCP 工具支持直接传入 GitLab URL 作为参数
