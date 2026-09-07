# PR Workflows

本目录下的 GitHub Actions 工作流用于 PR 检查和自动化代码审查。

## PR 检查（`pr-checks.yml`）

PR 创建/更新时触发，由以下 job 组成：

- **check-base-branch**：校验 PR 目标分支
- **build-test**：构建与测试
- **release-script-test**：验证发布脚本输出

## PR 检查（`pr-webui-checks.yml`）

PR 创建/更新时触发，`apps/webui` 的五项门禁（typecheck / lint / format:check / unit / contract）。执行前先在 root 跑 `build:packages` —— 既是 tsc 经 `types` 条件解析共享包 dist 的前提，也是 vitest 运行时经 `default` 条件加载共享包 dist 的前提。

## 其他工作流

`build-*` / `claude.yml` / `download-resources.yml` / `hotfix.yml` / `no-merge-commits.yml` / `pr-integration-smoke.yml` 等各自承担独立职责，详见各文件顶部说明。

`candidate-promotion.yml` / `pr-e2e-artifacts.yml` / `update-ai-dev-browser.yml` 为 `workflow_dispatch` 手动触发工具。
