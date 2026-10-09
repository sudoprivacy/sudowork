---
name: release-sudowork
description: Use when releasing a new version of Sudowork. Generates internal (shareone) and public (GitHub Release / in-app) release notes, bumps version, creates a release PR, tags, and injects the release body after CI publishes.
---

# Skill: release-sudowork

发布 Sudowork 新版本的标准 SOP。产出两份 release note：

- **对内版**（详细，中文）→ 存 `docs/release-notes/v{ver}.md`，由用户手动转发到 shareone 拿到分享链接
- **对外版**（精简，中文，面向用户）→ 存 `docs/release-notes/v{ver}-public.md`，末尾附对内版 shareone 链接，最终注入 GitHub Release body —— 这就是 App 内 UpdateModal「更新日志」区块展示的内容（`updateBridge.ts` 拉取 GitHub Release 的 `body` 字段渲染）

## 前置条件

- 在 `dev` 分支上，工作区干净，已 `git pull --rebase origin dev`
- `gh auth status` 正常（需要能编辑 sudoprivacy/sudowork 的 release）

任一不满足则停止并提示用户。

## Steps

### 1. 确定版本号

读 `package.json` 的 `version`。

- 有参数：直接使用指定版本
- 无参数：patch 位 +1（如 `0.2.11` → `0.2.12`）

显示：`Releasing: {current} → {target}`

### 2. 收集上次发版以来的 commit

找上一个正式版 tag（排除 nightly / rc / beta）：

```bash
git tag --sort=-creatordate | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1
```

收集 commit：

```bash
git log --oneline v{last}..HEAD --no-merges
```

按 conventional commit 前缀分类：`feat` → 新功能、`fix` → 修复、`perf` → 性能、`refactor`/`style`/`chore` → 工程重构。

### 3. 写对内版 release note

写入 `docs/release-notes/v{ver}.md`，风格参照 `docs/release-notes/v0.2.9.md`：

- 标题：`# Sudowork v{ver} Release Note`
- 开头引用块：自 v{last} 起累计 commit 数及各类型分布
- 章节：`## 重点新功能`（按功能域分小节）、`## 重要修复`、`## 性能`、`## 工程重构（无功能变更）`
- 详细程度：一个逻辑变更一条 bullet，可包含技术细节（模块名、协议、内部组件），这是给团队内部看的

### 4. 等待用户转发对内版到 shareone

对内版写好后，显示文件路径并提示：

> 对内版已写入 `docs/release-notes/v{ver}.md`，请转发到 shareone 后把分享链接发给我。

**暂停等待用户提供 shareone 链接**，拿到后用于下一步。

### 5. 写对外版 release note

写入 `docs/release-notes/v{ver}-public.md`：

- 中文、精简、面向最终用户 —— 只写用户可感知的变化，不写内部模块名/重构细节
- 结构建议：`## v{ver}` + `### 新功能` / `### 修复` / `### 性能`，每类 3~8 条 bullet
- Markdown 保持简单（标题、列表、粗体），UpdateModal 用 MarkdownView 渲染，避免 HTML、图片、表格
- **末尾追加一行**：

```markdown
---

> 📋 详细更新内容：{shareone URL}
```

### 6. Bump 版本

1. 更新 `package.json` 的 `version` 为 `{ver}`
2. `bun install`，然后 `git diff bun.lock` 确认无变化（有变化则询问用户）

> 不跑格式 / 类型 / 测试门禁 —— 发布流程只做版本 bump。

### 7. 创建 release PR

```bash
git checkout -b release/v{ver}
git add package.json docs/release-notes/v{ver}.md docs/release-notes/v{ver}-public.md
git commit -m "chore(release): bump version to {ver}"
git push -u origin release/v{ver}
gh pr create --base dev --title "chore(release): bump version to {ver}" --body "Release v{ver}"
```

**绝不添加任何 AI 署名**（Co-Authored-By、Generated with 等）到 commit 或 PR。

显示 PR URL，**暂停等待用户确认 PR 已合并**后再继续。

### 8. 打 tag 触发发布

PR 合并后：

```bash
git checkout dev
git pull --rebase origin dev
git branch -d release/v{ver}
git tag v{ver}
git push origin v{ver}
```

推 tag 会触发 `build-and-release.yml`：构建 mac-arm64 / mac-x64 / win-x64 → 创建 GitHub Release（**body 为空**）→ 上传安装包和 updater yml 到 COS 镜像。

### 9. 等待 CI 完成并注入 release body

监控构建（约 30~60 分钟）：

```bash
gh run list --workflow=build-and-release.yml --limit 1
gh run watch <run-id>
```

Release 创建成功后，注入对外版内容：

```bash
gh release edit v{ver} --notes-file docs/release-notes/v{ver}-public.md
```

### 10. 验证

```bash
gh release view v{ver} --json body,assets -q '.body[0:200] + "\n---\nassets: " + (.assets | length | tostring)'
```

确认：

- body 非空且为对外版内容（末尾含 shareone 链接）
- assets 包含 dmg / exe / zip / yml / blockmap
- COS 镜像 yml 已更新（可选：`curl -sI https://sudowork-release-1309794936.cos.ap-beijing.myqcloud.com/sudowork/release/latest/latest-mac.yml`）

完成后显示：`Release v{ver} 发布完成。App 内更新弹窗将展示对外版更新日志。`

## Notes

- **Release body 必须在 CI 创建 release 之后注入** —— workflow 用 `generate_release_notes: false` 且不传 body，创建出来的 release 正文是空的。
- App 内展示链路：UpdateModal 检测到新版本 → `updateBridge.ts` 请求 `api.github.com/repos/sudoprivacy/sudowork/releases` 取 `body` → MarkdownView 渲染；没有内容时显示 `update.noReleaseNotes` 兜底文案。
- 不要手动上传安装包或改 COS —— 全部由 tag 触发的 CI 处理。
- nightly / rc / beta 版本不走本 skill（它们不上 COS、标记为 prerelease）。
