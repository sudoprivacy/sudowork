# UX Polish Checklist - 丝滑度优化

> 范围：Loading/Empty/错误态、动画流畅度 (60fps)、键盘快捷键 + 可访问性、组件视觉一致性、卡顿点巡检

---

## 1. Loading / Empty / 错误态文案 + 视觉

### 1.1 Loading 状态

| 组件/页面 | 当前状态 | 问题 | 优先级 | 修复 PR |
|---------|---------|------|--------|--------|
| `InitLoading.tsx` | ✅ 有完善的进度条和状态显示 | 无需修改 | - | - |
| `SkillSelectorMenu.tsx` | ✅ 有 loadingText 支持 | 文案需统一 i18n | P2 | #XXX |
| `SlashCommandMenu.tsx` | ✅ 有 loadingText 支持 | 文案需统一 i18n | P2 | #XXX |
| `sendbox.tsx` | ✅ 有 loadingSkills 状态 | 技能加载时无视觉反馈 | P2 | #XXX |
| `AcpSendBox.tsx` | ✅ 有 aiProcessing 状态 | 思考状态展示不完整 | P2 | #XXX |
| 设置页面表单 | ⚠️ 部分表单有 loading | 缺少统一的表单 loading 态 | P3 | #XXX |

**待修复问题：**
- [ ] 统一 loading 文案 i18n key（当前部分使用硬编码英文）
- [ ] 技能选择器加载时添加骨架屏动画
- [ ] 设置页面表单添加统一 loading 态

### 1.2 Empty 状态

| 组件/页面 | 当前状态 | 问题 | 优先级 | 修复 PR |
|---------|---------|------|--------|--------|
| `SkillSelectorMenu.tsx` | ✅ 有 emptyText/noSearchResultsText | 需增加空状态插图 | P3 | #XXX |
| `SlashCommandMenu.tsx` | ✅ 有 emptyText | 文案需 i18n | P2 | #XXX |
| `ChatHistory.tsx` | ⚠️ 简单 empty 文本 | 缺少引导操作 | P2 | #XXX |
| 工作空间文件树 | ⚠️ 简单 empty 文本 | 缺少引导操作 | P2 | #XXX |

**待修复问题：**
- [ ] 空状态统一添加引导操作（如「添加技能」、「选择文件」按钮）
- [ ] 空状态文案统一 i18n
- [ ] 考虑添加空状态插图/图标

### 1.3 错误态

| 组件/页面 | 当前状态 | 问题 | 优先级 | 修复 PR |
|---------|---------|------|--------|--------|
| `InitLoading.tsx` | ✅ 完善的错误态 + 重试机制 | 无需修改 | - | - |
| `AcpSendBox.tsx` | ✅ 有错误消息展示 | 错误样式需统一 | P2 | #XXX |
| `sendbox.tsx` | ⚠️ 错误处理不完整 | 缺少错误态 UI | P2 | #XXX |
| 表单提交 | ⚠️ 使用 Message.error | 缺少内联错误提示 | P3 | #XXX |

**待修复问题：**
- [ ] 统一错误消息样式（红色边框 + 图标 + 文案）
- [ ] 表单字段添加内联错误提示
- [ ] 错误重试机制统一

---

## 2. 动画流畅度 (60fps)

### 2.1 现有动画

| 动画名称 | 位置 | 当前 FPS | 问题 | 优先级 |
|---------|------|---------|------|--------|
| `fade-in` | `index.module.css` | ✅ 60fps | 无需修改 | - |
| `guid-shimmer` | `index.module.css` | ✅ 60fps | 仅用于 skeleton | - |
| `agentSelectPop` | `index.module.css` | ✅ 60fps | 使用 cubic-bezier | - |
| `streaming-border-pulse` | `base.css` | ✅ 60fps | AI 输出边框脉冲 | - |
| `preview-panel-enter` | `base.css` | ✅ 60fps | 预览面板进入 | - |
| 侧边栏收起展开 | `base.css` | ⚠️ 可能掉帧 | 使用了 transform/opacity | P2 |
| Braille  spinner | `InitLoading.tsx` | ✅ 60fps | 使用 requestAnimationFrame | - |

### 2.2 性能优化机会

| 组件 | 问题 | 建议 | 优先级 |
|------|------|------|--------|
| `SkillSelectorMenu.tsx` | 列表项无虚拟化 | 长列表考虑虚拟滚动 | P3 |
| `ChatHistory.tsx` | 历史会话全量渲染 | 添加虚拟滚动 | P2 |
| `sendbox.tsx` | 频繁状态更新 | 使用 `useDeferredValue` 优化输入 | P3 |
| `MessageList.tsx` | 消息全量渲染 | 考虑消息虚拟化 | P2 |

**待修复问题：**
- [ ] 检查所有动画是否使用 `transform` 和 `opacity`（GPU 加速）
- [ ] 为长列表添加虚拟滚动（ConversationHistory、SkillList）
- [ ] 使用 `React.memo` 优化不必要的重渲染
- [ ] 输入框使用 `useDeferredValue` 优化打字体验

---

## 3. 键盘快捷键 + 可访问性

### 3.1 键盘导航

| 组件/功能 | 当前状态 | 问题 | 优先级 | 修复 PR |
|---------|---------|------|--------|--------|
| `@技能` 选择器 | ✅ 支持 ↑↓ Enter Escape Tab | 功能完整 | - | - |
| `/` 命令菜单 | ✅ 支持 ↑↓ Enter Escape | 功能完整 | - | - |
| 会话列表 | ⚠️ 部分支持 | 缺少键盘导航 | P2 | #XXX |
| 设置侧边栏 | ⚠️ 部分支持 | 缺少键盘导航 | P2 | #XXX |
| 预览面板 | ✅ 有快捷键系统 | 功能完整 | - | - |
| 模态框 | ⚠️ Escape 关闭不一致 | 统一 Escape 行为 | P2 | #XXX |

### 3.2 快捷键清单

| 快捷键 | 功能 | 作用范围 | 状态 |
|-------|------|---------|------|
| `@` | 打开技能/文件选择器 | 输入框 | ✅ |
| `/` | 打开命令菜单 | 输入框 | ✅ |
| `Enter` | 发送消息 | 输入框 | ✅ |
| `Shift+Enter` | 换行 | 输入框 | ✅ |
| `Escape` | 关闭选择器/模态框 | 全局 | ⚠️ |
| `Tab` | 切换技能/文件 tab | 选择器内 | ✅ |
| `↑/↓` | 导航选项 | 选择器内 | ✅ |
| `Ctrl/Cmd+K` | 快速搜索 | 全局 | ❌ 待实现 |
| `Ctrl/Cmd+Enter` | 发送消息 | 输入框 | ⚠️ 待统一 |

### 3.3 可访问性 (A11Y)

| 组件 | ARIA 属性 | 焦点管理 | 屏幕阅读器 | 优先级 |
|------|----------|---------|-----------|--------|
| `SkillSelectorMenu` | ✅ `role="listbox"` | ✅ | ⚠️ | P2 |
| `SlashCommandMenu` | ✅ `role="listbox"` | ✅ | ⚠️ | P2 |
| `sendbox.tsx` | ⚠️ 部分缺失 | ✅ | ❌ | P2 |
| 模态框 | ⚠️ 部分缺失 | ⚠️ | ❌ | P2 |
| 按钮 | ✅ 基本完整 | - | ✅ | - |

**待修复问题：**
- [ ] 统一 Escape 键关闭行为（选择器、模态框、面板）
- [ ] 实现 `Ctrl/Cmd+K` 全局搜索快捷键
- [ ] 为所有交互组件添加 `aria-label`
- [ ] 模态框添加焦点陷阱（focus trap）
- [ ] 为图标按钮添加 `aria-label`

---

## 4. 组件视觉一致性

### 4.1 间距系统

当前使用的间距值（来自代码分析）：

| 用途 | 当前值 | 建议统一值 |
|------|--------|-----------|
| 组件内边距 | `8px/10px/12px/14px/16px/24px` | 统一为 `8/12/16/20/24/32` |
| 组件间距 | `6px/8px/10px/12px/16px` | 统一为 `8/12/16/24` |
| 卡片圆角 | `8px/10px/12px/14px/16px/20px/22px` | 统一为 `8/12/16/20` |
| 按钮圆角 | `6px/8px/10px/12px/999px` | 统一为 `8/12/999(胶囊)` |

**问题：**
- [ ] 圆角值过于分散，建议统一为 3-4 个标准值
- [ ] 间距值需要统一为 4px 倍数系统

### 4.2 字号系统

| 场景 | 当前使用值 | 建议统一 |
|------|-----------|---------|
| 主要标题 | `24px/26px/34px` | `24/28/32` |
| 次级标题 | `13px/14px/16px/18px` | `14/16/18` |
| 正文 | `13px/14px/15px/16px` | `14/16` |
| 辅助文字 | `9px/10px/11px/12px/13px` | `12/14` |
| 小字 | `9px/10px/11px` | `11/12` |

**问题：**
- [ ] 字号值过于分散，建议统一为 5-6 个标准值
- [ ] 移动端字体需要单独 scale

### 4.3 配色系统

当前配色变量（来自 `base.css`）：

```css
/* 文本颜色 */
--text-primary
--text-secondary
--text-tertiary

/* 背景颜色 */
--bg-1, --bg-2, --bg-3
--fill-0, --fill-1, --fill-2, --fill-3

/* 边框颜色 */
--border-base, --color-border-2, --color-border-3

/* 主题色 */
--color-primary, --primary-6
--aou-2 (选中状态)
```

**问题：**
- [ ] 部分组件使用硬编码颜色值（如 `#f8fafc`, `#60a5fa`）
- [ ] 需要统一所有硬编码颜色到 CSS 变量

### 4.4 阴影系统

| 用途 | 当前值 | 建议统一 |
|------|--------|---------|
| 下拉菜单 | `0 8px 24px rgba(0,0,0,0.12)` | 统一变量 |
| 卡片 | `0 12px 28px rgba(3,8,18,0.22)` | 统一变量 |
| 按钮 | - | 添加统一变量 |

**待修复问题：**
- [ ] 统一所有阴影值为 CSS 变量
- [ ] 建立 shadow scale (sm/md/lg/xl)

---

## 5. 卡顿点巡检

### 5.1 已知卡顿点

| 位置 | 症状 | 可能原因 | 优先级 |
|------|------|---------|--------|
| 输入框打字 | 长文本时掉帧 | 无防抖/节流 | P2 |
| 技能选择器 | 技能多时滚动卡顿 | 无虚拟滚动 | P3 |
| 会话历史 | 会话多时展开卡顿 | 全量渲染 | P2 |
| 消息列表 | 消息多时滚动卡顿 | 无虚拟滚动 | P2 |
| 文件树 | 大目录展开卡顿 | 全量渲染 | P3 |

### 5.2 性能分析建议

| 优化项 | 当前实现 | 建议 | 预期收益 |
|--------|---------|------|---------|
| 输入防抖 | ❌ 无 | 添加 `useDebounce` | 减少 80% 重渲染 |
| 列表虚拟化 | ❌ 无 | 使用 `react-window` | 长列表流畅度 +300% |
| 图片懒加载 | ⚠️ 部分 | 统一实现 IntersectionObserver | 首屏加载 -50% |
| 大文件解析 | ❌ 无 | Web Worker 后台处理 | 避免主线程阻塞 |

**待修复问题：**
- [ ] 输入框添加防抖（特别是 @搜索）
- [ ] 长列表实现虚拟滚动
- [ ] 使用 `useMemo` 缓存计算结果
- [ ] 避免在 render 中创建新对象/数组

---

## 修复 PR 列表（按优先级排序）

| PR # | 标题 | 范围 | 优先级 | 状态 |
|------|------|------|--------|------|
| #XXX | perf: 输入框防抖优化 | 卡顿点 | P0 | ✅ |
| #XXX | fix: 统一错误消息样式 | 错误态 | P0 | ✅ |
| #XXX | fix: 统一 Escape 键行为 | 可访问性 | P0 | ⏳ |
| #XXX | perf: 会话列表虚拟滚动 | 流畅度 | P1 | ⏳ |
| #XXX | perf: 消息列表虚拟滚动 | 流畅度 | P1 | ⏳ |
| #XXX | feat: Ctrl+K 全局搜索 | 快捷键 | P1 | ⏳ |
| #XXX | fix: 模态框焦点陷阱 | 可访问性 | P1 | ⏳ |
| #XXX | fix: 空状态引导操作 | Empty 态 | P1 | ⏳ |
| #XXX | a11y: 为图标按钮添加 aria-label | 可访问性 | P2 | ⏳ |
| #XXX | a11y: 统一模态框 ARIA 属性 | 可访问性 | P2 | ⏳ |
| #XXX | fix: 技能选择器骨架屏动画 | Loading 态 | P2 | ⏳ |
| #XXX | fix: 统一 loading 文案 i18n | Loading 态 | P2 | ⏳ |
| #XXX | fix: 表单内联错误提示 | 错误态 | P2 | ⏳ |
| #XXX | fix: 侧边栏收起展开动画优化 | 流畅度 | P2 | ⏳ |
| #XXX | style: 统一圆角系统 | 视觉一致性 | P3 | ⏳ |
| #XXX | style: 统一间距系统 | 视觉一致性 | P3 | ⏳ |
| #XXX | style: 统一字号系统 | 视觉一致性 | P3 | ⏳ |
| #XXX | style: 硬编码颜色转 CSS 变量 | 视觉一致性 | P3 | ⏳ |
| #XXX | style: 统一阴影系统 | 视觉一致性 | P3 | ⏳ |
| #XXX | feat: 空状态插图/图标 | Empty 态 | P3 | ⏳ |
| #XXX | perf: 技能选择器虚拟滚动 | 流畅度 | P3 | ⏳ |
| #XXX | perf: 文件树大目录优化 | 卡顿点 | P3 | ⏳ |

---

## 总结

### 高优先级 (P0/P1) - 立即执行
1. **输入框防抖优化** - 核心交互流畅度
2. **统一错误消息样式** - 错误态视觉一致性
3. **统一 Escape 键行为** - 交互一致性
4. **会话/消息列表虚拟滚动** - 长列表性能
5. **Ctrl+K 全局搜索** - 效率提升
6. **模态框焦点陷阱** - 键盘导航
7. **空状态引导操作** - 用户引导

### 中优先级 (P2) - 近期规划
1. ARIA 可访问性改进（图标按钮、模态框）
2. Loading 态优化（骨架屏、i18n）
3. 表单错误提示优化
4. 动画性能优化

### 低优先级 (P3) - 长期优化
1. 视觉系统统一（圆角、间距、字号、颜色、阴影）
2. 空状态视觉优化
3. 其他性能优化（技能选择器、文件树）

---

*最后更新：2026-04-21*

---

## 已完成 Commit 记录

### 2026-04-21 - P0: 统一错误消息样式

**Commit:** `feat(ux): 统一错误消息样式和内联错误提示`

**新增文件：**
- `src/renderer/utils/errorToast.ts` - 统一错误/成功/警告/信息 Toast 工具
- `src/renderer/components/ErrorBoundary.tsx` - 统一错误边界组件
- `src/renderer/hooks/useFormErrors.ts` - 表单错误管理 Hook + 常用验证规则

**修改文件：**
- `src/renderer/styles/themes/base.css` - 添加统一错误样式 CSS 类

**功能清单：**
1. **统一 Toast 消息**
   - `showErrorToast` - 错误消息
   - `showSuccessToast` - 成功消息
   - `showWarningToast` - 警告消息
   - `showInfoToast` - 信息消息
   - `handleErrorResponse` - 统一错误处理
   - `showErrorToastWithRetry` - 带重试按钮的错误消息

2. **错误边界组件**
   - `<ErrorBoundary>` - React 错误边界组件
   - `useErrorHandler` - 错误处理 Hook

3. **表单错误管理**
   - `useFormErrors` - 表单错误状态管理 Hook
   - `FormValidators` - 常用验证规则（必填、邮箱、手机号、URL 等）

4. **统一 CSS 样式类**
   - `.error-message-container` - 错误消息容器
   - `.error-message-icon` - 错误图标
   - `.error-message-content` - 错误内容
   - `.form-field-error` - 表单内联错误
   - `.error-boundary-fallback` - 错误边界降级 UI

---

### 2026-04-21 - P0: 输入框防抖优化 + 重复项修复

**Commit:** `fix(performance): 优化 @技能选择器性能并修复重复项问题`

**修改文件：**
- `src/renderer/hooks/useSkillSelectorController.ts` - 添加 150ms 防抖、filterDisabled 选项
- `src/renderer/pages/guid/GuidPage.tsx` - 去重逻辑、Set 优化查找、filterDisabled: true
- `src/renderer/components/sendbox.tsx` - 去重逻辑

**修复内容：**
1. 添加 150ms 防抖延迟，减少搜索时频繁计算和重渲染
2. 修复搜索时出现重复技能项的问题（two children with same key 警告）
3. Guide 页面不显示禁用的技能
4. 使用 Set 优化技能过滤查找性能（O(1) vs O(n)）
5. 使用 Map 对技能列表去重，确保 key 唯一性

