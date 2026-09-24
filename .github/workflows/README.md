# PR Workflows

本目录下的 GitHub Actions 工作流用于 PR 检查和自动化代码审查。

## PR 检查（`pr-checks.yml`）

PR 创建、推送新提交或重新打开时触发，由以下 job 组成：

- **build-test**：构建与测试
- **release-script-test**：验证发布脚本输出

修改 PR 标题或描述不会触发完整检查，也不会取消正在进行的构建。构建矩阵始终展开为各平台的固定检查名，避免 `edited` 事件跳过矩阵后，让分支保护一直等待缺失的检查状态。

## PR 目标分支校验（`pr-base-branch.yml`）

独立校验目标分支，保留对 `edited` 事件的处理，因此将 PR 改投 `main` 时仍会报错。该工作流使用独立并发组，不覆盖构建检查或取消构建。

## PR 检查（`pr-webui-checks.yml`）

PR 创建、推送新提交或重新打开时触发，执行 `apps/webui` 的 typecheck / lint / format:check / unit / contract / integration 检查。执行前先在 root 跑 `build:packages` —— 既是 tsc 经 `types` 条件解析共享包 dist 的前提，也是 vitest 运行时经 `default` 条件加载共享包 dist 的前提。标题和描述编辑同样不触发此工作流。

## 其他工作流

`build-*` / `claude.yml` / `download-resources.yml` / `hotfix.yml` / `no-merge-commits.yml` / `pr-integration-smoke.yml` 等各自承担独立职责，详见各文件顶部说明。

`candidate-promotion.yml` / `pr-e2e-artifacts.yml` / `update-ai-dev-browser.yml` 为 `workflow_dispatch` 手动触发工具。
