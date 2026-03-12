---
description: GitLab 开发助手 — 结合 GitLab MCP 和 glab CLI 管理项目、MR、Issue 和 CI/CD
---

# GitLab 开发助手

GitLab 项目管理和 CI/CD 开发专家。结合 GitLab MCP 和 glab CLI 操作 GitLab。

## 触发场景

用户提到以下关键词时使用此 skill：
- gitlab、glab、merge request、MR、issue
- CI/CD、pipeline、.gitlab-ci.yml
- container registry、镜像构建

## 依赖检查

### 初次使用检查命令

```bash
# 检查 glab CLI 是否安装
which glab || echo "glab 未安装"

# 检查 glab 是否已认证
glab auth status 2>/dev/null || echo "glab 未认证"
```

### GitLab MCP 配置

GitLab MCP 通过 Claude Code 的 MCP 配置管理：

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

### glab CLI 安装

| 平台 | 安装命令 |
|------|---------|
| macOS | `brew install glab` |
| Linux (apt) | `apt install glab` |
| Windows | `winget install glab` |

安装后认证：
```bash
glab auth login --token <PAT> --hostname <gitlab-host>
```

## 工具选择策略

**原则：MCP 优先，glab CLI 补充**

### GitLab MCP 工具（优先使用）

MCP 工具通过 Claude Code 内置支持，无需额外认证步骤。

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

| 操作类别 | glab 命令 | 说明 |
|---------|----------|------|
| MR 状态变更 | `glab mr merge <iid>` | 合并 MR |
| | `glab mr close <iid>` | 关闭 MR |
| | `glab mr approve <iid>` | 批准 MR |
| MR 更新 | `glab mr update <iid> --title "..."` | 更新 MR 标题 |
| | `glab mr update <iid> --description "..."` | 更新 MR 描述 |
| Issue 状态变更 | `glab issue close <iid>` | 关闭 Issue |
| Pipeline 操作 | `glab pipeline run` | 触发 Pipeline |
| | `glab ci lint` | 验证 .gitlab-ci.yml |

## 工作流程示例

### 查看 Issue 并创建 MR

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

### .gitlab-ci.yml 最佳实践

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
      else
        IMAGE_TAG="dev"
      fi
      docker build -t "$REGISTRY/$IMAGE_NAME:$IMAGE_TAG" -f Dockerfile .
      docker push "$REGISTRY/$IMAGE_NAME:$IMAGE_TAG"
```

## 注意事项

1. **工具选择顺序**：优先使用 MCP 工具，MCP 不支持的操作再用 glab CLI
2. **glab 认证**：使用 PAT 登录，需要 `api` 权限
3. **项目 ID 格式**：MCP 工具的 `id` 参数使用 URL 编码路径（如 `group/project`）
4. **URL 支持**：部分 MCP 工具支持直接传入 GitLab URL 作为参数
