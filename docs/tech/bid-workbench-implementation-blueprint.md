# 招标文件编制工作台研发实施蓝图

## 1. 目标

本蓝图用于指导“招标文件编制工作台”从当前 P2 MVP 升级为完整 AI 版本，重点覆盖：
- 材料池与解析
- RAGFlow / 企业知识增强接入
- 完整初稿自动生成
- 章节级修订与联动修订
- 合规审查与修复闭环
- DOCX 导出与回归测试

## 2. 模块拆分

### 2.1 Renderer 模块

#### 页面
- `src/renderer/pages/bid-projects/index.tsx`
- `src/renderer/pages/bid-projects/new.tsx`
- `src/renderer/pages/bid-projects/analysis.tsx`
- `src/renderer/pages/bid-projects/editor.tsx`

#### 新增建议目录
- `src/renderer/pages/bid-projects/components/`
- `src/renderer/pages/bid-projects/hooks/`
- `src/renderer/pages/bid-projects/services/`（如仅做 renderer adapter）

#### 建议组件
- `BidProjectMaterialList`
- `BidProjectFactReviewPanel`
- `BidProjectGenerationProgress`
- `BidProjectSectionTree`
- `BidProjectTemplatePicker`
- `BidProjectCitationDrawer`
- `BidProjectCompliancePanel`
- `BidProjectVersionPanel`

### 2.2 Common 模块

建议新增：
- `src/common/bid-projects/types.ts`
- `src/common/bid-projects/schemas.ts`
- `src/common/bid-projects/status.ts`
- `src/common/bid-projects/prompts.ts`

职责：
- 共享类型
- 状态定义
- Zod 边界校验
- 生成/审查 prompt 拼装辅助

### 2.3 Process 模块

建议新增：
- `src/process/services/bid-projects/BidProjectService.ts`
- `src/process/services/bid-materials/ProjectMaterialPipeline.ts`
- `src/process/services/bid-materials/MaterialFactExtractor.ts`
- `src/process/services/bid-generation/GenerateBidDraftService.ts`
- `src/process/services/bid-generation/BidTemplatePlanner.ts`
- `src/process/services/bid-generation/BidSectionGenerator.ts`
- `src/process/services/bid-review/BidReviewService.ts`
- `src/process/services/bid-review/BidRuleReviewEngine.ts`
- `src/process/services/bid-review/BidReviewFixApplier.ts`

职责拆分：
- `BidProjectService`：项目 CRUD、状态管理
- `ProjectMaterialPipeline`：文件解析、摘要、证据片段整理
- `MaterialFactExtractor`：候选事实抽取、冲突检测
- `GenerateBidDraftService`：完整生成编排
- `BidTemplatePlanner`：模板匹配、章节规划
- `BidSectionGenerator`：章节级生成与重生成
- `BidReviewService`：审查编排
- `BidRuleReviewEngine`：规则审查
- `BidReviewFixApplier`：修复建议应用

### 2.4 Bridge 模块

建议新增：
- `src/process/bridge/bidProjectBridge.ts`

需要同时改：
- `src/preload.ts`
- `src/common/ipcBridge.ts`

## 3. 数据库设计

建议新增以下表。

### 3.1 `bid_projects`
字段建议：
- `id`
- `name`
- `company`
- `budget`
- `project_type`
- `industry`
- `target`
- `duration`
- `procurement_method`
- `region`
- `remark`
- `status`
- `selected_template`
- `current_draft_id`
- `current_version`
- `created_at`
- `updated_at`

### 3.2 `bid_project_sources`
字段建议：
- `id`
- `project_id`
- `file_name`
- `file_path`
- `mime_type`
- `size`
- `parse_status`
- `parse_error`
- `extracted_text`
- `summary`
- `created_at`
- `updated_at`

### 3.3 `bid_project_facts`
字段建议：
- `id`
- `project_id`
- `field_name`
- `candidate_value`
- `confidence`
- `source_file_id`
- `source_snippet`
- `status` (`pending` / `confirmed` / `rejected`)
- `created_at`
- `updated_at`

### 3.4 `bid_project_drafts`
字段建议：
- `id`
- `project_id`
- `version`
- `markdown`
- `generation_mode`
- `template_name`
- `status`
- `created_at`
- `updated_at`

### 3.5 `bid_project_sections`
字段建议：
- `id`
- `project_id`
- `draft_id`
- `section_key`
- `section_title`
- `sort_order`
- `content_markdown`
- `status`
- `is_locked`
- `citations_json`
- `issues_json`
- `created_at`
- `updated_at`

### 3.6 `bid_project_reviews`
字段建议：
- `id`
- `project_id`
- `draft_id`
- `review_type`
- `status`
- `summary`
- `created_at`
- `updated_at`

### 3.7 `bid_project_review_issues`
字段建议：
- `id`
- `review_id`
- `severity`
- `title`
- `description`
- `section_key`
- `location_text`
- `suggestion`
- `citations_json`
- `status` (`open` / `applied` / `ignored`)
- `created_at`
- `updated_at`

### 3.8 `bid_project_user_actions`
字段建议：
- `id`
- `project_id`
- `action_type`
- `payload_json`
- `created_at`

### 3.9 `bid_project_exports`
字段建议：
- `id`
- `project_id`
- `draft_id`
- `format`
- `file_name`
- `output_path`
- `created_at`

## 4. IPC 接口设计

建议在 `src/common/ipcBridge.ts` 增加 `bidProject` 分组。

### 4.1 项目接口
- `createProject`
- `getProject`
- `listProjects`
- `updateProject`
- `deleteProject`（如需要）

### 4.2 材料接口
- `uploadSource`
- `listSources`
- `parseSource`
- `parseAllSources`

### 4.3 候选事实接口
- `listFacts`
- `confirmFact`
- `rejectFact`
- `applyFactValue`

### 4.4 生成接口
- `generateDraft`
- `getGenerationStatus`
- `regenerateSection`
- `applySectionVariant`
- `replanTemplate`

### 4.5 审查接口
- `runReview`
- `listReviewIssues`
- `applyReviewFix`
- `ignoreReviewIssue`

### 4.6 导出接口
- `exportDocx`
- `exportReviewReport`

## 5. 状态机设计

### 5.1 项目状态机
- `draft`
- `analyzing`
- `awaiting_confirmation`
- `generating`
- `generated`
- `reviewing`
- `exported`

状态流转建议：
- `draft -> analyzing`
- `analyzing -> awaiting_confirmation`
- `awaiting_confirmation -> generating`
- `generating -> generated`
- `generated -> reviewing`
- `reviewing -> generated`
- `generated -> exported`

### 5.2 章节状态机
- `empty`
- `generated`
- `edited`
- `locked`
- `needs_review`
- `needs_regeneration`

## 6. AI 调用与 RAGFlow 集成蓝图

### 6.1 复用现有增强链路
优先复用：
- `src/process/services/dify/enhancement.ts`
- `src/process/bridge/difyBridge.ts`

### 6.2 生成时机
在以下环节调用增强：
- 模板推荐前
- 章节规划前
- 单章节生成前
- 审查前
- 联动修订前

### 6.3 Query 组装
建议 query 由以下信息拼接：
- 项目画像
- 当前章节目标
- 材料摘要
- 已确认事实
- 缺失项
- 风险点

### 6.4 返回数据
要求尽量保留：
- `text`
- `mode`
- `citations`

## 7. 页面实施清单

### Phase 1 页面改造
#### `new.tsx`
- 增加行业、地区等字段
- 上传材料后调用真实接口
- 不再只存本地文件名

#### `analysis.tsx`
- 展示材料解析状态
- 展示候选事实
- 支持确认/拒绝候选值
- 只有确认完成后才允许进入生成

### Phase 2 页面改造
#### `analysis.tsx`
- 增加生成按钮
- 增加生成进度反馈

#### `editor.tsx`
- 首次进入时展示完整初稿
- 展示章节状态
- 展示模板与生成信息

### Phase 3 页面改造
#### `editor.tsx`
- 增加章节锁定
- 增加 citations 查看
- 增加重生成当前章节
- 增加模板切换
- 增加联动修订批量应用

### Phase 4 页面改造
#### `editor.tsx`
- 底部审查面板接真实审查数据
- 支持应用修复 / 忽略问题 / 再审查

## 8. 版本与保存策略

### 最低实现
- 自动生成初稿后保存为 V1
- 手动保存产生新版本
- 审查修复后可形成新版本

### 可复用模式
参考：
- `src/renderer/pages/conversation/preview/hooks/usePreviewHistory.ts`
- `src/process/services/previewHistoryService.ts`

## 9. 开发顺序

### 第一步：PRD / 蓝图
- 完整方案文档
- 工程蓝图

### 第二步：Phase 1
- DB
- Bridge
- Material pipeline
- Fact review

### 第三步：Phase 2
- Draft generation
- Enhancement integration
- Full draft rendering

### 第四步：Phase 3
- Section regenerate
- Template replan
- Citation drawer
- Section lock

### 第五步：Phase 4
- Review engine
- Review UI integration
- Fix apply loop

### 第六步：Phase 5
- Export polish
- Regression tests
- Demo assets

## 10. 自测计划

### 10.1 每阶段通用检查
- `bunx eslint <changed-files> --fix`
- `bunx tsc --noEmit`

### 10.2 Phase 1 自测
- 新建项目后刷新仍存在
- 上传 `docx/txt/md/pdf` 后解析成功
- 候选事实正确显示
- 确认事实后项目画像更新

### 10.3 Phase 2 自测
- 新建项目 → 上传材料 → 确认字段 → 自动生成初稿
- 初稿不是空白模板
- 初稿包含项目字段与材料事实

### 10.4 Phase 3 自测
- 重生成单章节成功
- 锁定章节不被覆盖
- citations 可查看
- 模板切换需要确认

### 10.5 Phase 4 自测
- 规则问题能命中
- 应用修复后正文更新
- 再审查状态变化正确

### 10.6 Phase 5 自测
- DOCX 成功导出
- Word 打开正常
- 浏览器黄金路径完整通过

## 11. 明早验收标准

只有满足以下条件，才建议直接对客户演示：
- 黄金路径完整跑通
- AI 自动生成整份初稿可见
- 依据/citations 可见
- 审查与修复可见
- DOCX 导出可用
- 异常有兜底
- 演示材料已准备

若以上未全部满足，则结论应为：
- 可内部验收
- 不建议直接对客户正式演示
