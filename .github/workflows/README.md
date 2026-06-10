# PR Workflows

本目录下的 GitHub Actions 工作流用于 PR 检查和自动化代码审查。

## PR 检查（`pr-checks.yml`）

PR 创建/更新时触发，由以下 job 组成：

- **check-base-branch**：校验 PR 目标分支
- **build-test**：构建与测试
- **release-script-test**：验证发布脚本输出

## 自动代码审查（`claude-code-review.yml`）

PR 在 `opened` / `synchronize` / `ready_for_review` / `reopened` 时由 Claude Code 完成代码审查。所有实际的 PR review 评论都来自这条链路。

## 其他工作流

`build-*` / `claude.yml` / `download-resources.yml` / `hotfix.yml` / `no-merge-commits.yml` / `pr-integration-smoke.yml` 等各自承担独立职责，详见各文件顶部说明。

`candidate-promotion.yml` / `pr-e2e-artifacts.yml` / `update-ai-dev-browser.yml` 为 `workflow_dispatch` 手动触发工具。
