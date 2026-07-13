# 招标文件编制系统开发前评估与实施计划

## 1. 文档目的

本文档用于基于当前 `feat/p2-bid-workbench` 分支中的已有代码，完成三件事：

1. 识别哪些代码可以直接复用；
2. 识别哪些代码适合保留但需要重构；
3. 在此基础上形成正式的一期开发 Plan 与开发任务拆解。

目标不是推倒重来，而是采用：

> **保留底层骨架 + 重构前端交互 + 升级知识库接入与生成策略**

的方式推进招标文件编制系统。

---

## 2. 总体结论

### 2.1 结论摘要

当前分支虽然没有把产品真正开发成功，但并不是“无成果”。

从工程视角看，已经有一套可以复用的基础骨架，尤其是在：
- 数据模型
- 主进程服务
- IPC 边界
- 数据库存储方向
- 页面路由挂载

这些层面，已经形成了比较正确的系统雏形。

### 2.2 建议策略

建议不要单独起新 repo，也不要删除当前 `bid-projects` 这一整套。应采用：

- **直接复用底层骨架**
- **保留页面路由与模块边界**
- **按新原型重构前端交互**
- **把现有单模板/单场景逻辑降级为 fallback 或 adapter**
- **逐步接入线上 RAGFlow 知识库体系**

### 2.3 推荐工作方式

建议在 Sudowork 当前仓库内，围绕 `bid-projects` 模块继续演进，而不是拆新 repo。原因是：

- 当前场景已经接入主导航与路由；
- Electron + WebUI 双形态能力已具备；
- IPC / 主进程 / 数据库 / 文档导出 / 鉴权 / AI 接入能力都可直接复用；
- 一期重点是先把“编制工作台”打通，而不是独立产品化。

---

## 3. 代码复用评估清单

## 3.1 强复用（建议直接保留）

### A. 共享类型骨架
文件：
- `src/common/bid-projects/types.ts`

当前已具备：
- 项目实体 `IBidProjectEntity`
- 材料实体 `IBidProjectSourceRecord`
- 候选事实实体 `IBidProjectFactRecord`
- 草稿实体 `IBidProjectDraftRecord`
- 详情聚合 `IBidProjectDetail`
- 基础状态定义：项目状态、材料解析状态、候选事实状态
- AI 章节生成输入/输出结构

为什么值得保留：
- 已经把系统核心领域对象抽象对了；
- 后续只需要继续扩字段，而不需要重造对象体系；
- 非常适合承载一期系统的数据库、IPC、service 和前端 view model。

建议后续补充：
- 章节状态
- 审查问题实体
- 版本历史实体
- 来源系统类型
- citations / 依据命中
- 知识资产命中
- AI 对话上下文实体

结论：**强复用**。

---

### B. 主进程服务骨架
文件：
- `src/process/services/bid-projects/BidProjectService.ts`

当前已具备：
- `listProjects()`
- `getProject()`
- `createProject()`
- `updateProject()`
- `parseAllSources()`
- `confirmFact()`
- `rejectFact()`
- `generateDraft()`
- `generateAiSections()`

为什么值得保留：
- 已经把创建项目、入库草稿、解析材料、候选字段确认、草稿生成、章节级 AI 重写串起来了；
- `parseAllSources()` 已经是材料处理 pipeline 雏形；
- `confirmFact()/rejectFact()` 正好承接“关键字段先确认”的业务规则；
- `generateAiSections()` 已有 enhancement / direct model / rule fallback 三层兜底思路。

需要调整的地方：
- 去掉对单一模板的硬编码：
  - `DEFAULT_TEMPLATE = '联通直接采购模板'`
  - `buildUnicomDirectProcurementMarkdown()`
- 把“联通直采专用生成器”降级为模板 adapter 或 fallback renderer；
- 扩展章节范围，不再只支持 `notice` / `technical` 两个 section key；
- 把材料解析、候选事实、模板规划、整稿生成、审查修复逐步拆分为更清晰的子 service。

结论：**强复用，但要去单模板硬编码**。

---

### C. IPC bridge 骨架
文件：
- `src/process/bridge/bidProjectBridge.ts`
- `src/common/ipcBridge.ts`

当前已具备：
- listProjects
- getProject
- createProject
- updateProject
- parseAllSources
- generateAiSections
- confirmFact
- rejectFact

为什么值得保留：
- 模块边界正确；
- 已经按 Sudowork 的架构方式接入；
- 后续只要继续扩接口，而不是重建通信层。

结论：**强复用**。

---

### D. 数据库方向与存储骨架
文件：
- `src/process/database/schema.ts`
- `src/process/database/migrations.ts`

当前已具备：
- `bid_projects`
- `bid_project_sources`
- `bid_project_facts`
- `bid_project_drafts`

为什么值得保留：
- 说明该模块已经进入正式数据库体系，而不是临时 mock；
- 支撑项目、材料、候选事实、草稿的最小闭环；
- 适合继续用 migration 方式扩表。

后续建议新增或扩展：
- 章节表 / section 状态
- 审查问题表
- 版本历史表
- AI 对话记录表（如需要持久化）
- 来源系统输入表（如需要区分导入类型）
- citations / asset hits 表或 JSON 字段

结论：**强复用**。

---

### E. 路由与导航接入
文件：
- `src/renderer/router.tsx`
- `src/renderer/layouts/components/Sider.tsx`

为什么值得保留：
- 已经纳入 Sudowork 主导航；
- 说明该场景不是外部 demo，而是正式产品模块；
- 路由基础已经存在，可直接演进。

结论：**强复用**。

---

## 3.2 保留重构（保留思路，重做交互）

### A. 列表页
文件：
- `src/renderer/pages/bid-projects/index.tsx`

当前已有：
- 项目列表
- quick actions
- 空态
- 基本跳转

问题：
- 更像功能入口页，不像项目工作台；
- 缺少状态筛选、风险数、待确认数、来源系统信号、平台能力入口。

建议：
- 保留路由页与加载方式；
- 重做信息结构和卡片密度；
- 加入统计卡片、状态筛选、平台能力表达。

结论：**保留重构**。

---

### B. 新建页
文件：
- `src/renderer/pages/bid-projects/new.tsx`

当前已有：
- 表单输入
- 文件上传
- 提交创建项目

问题：
- 还是单页表单；
- 没有 step flow；
- 没有来源系统输入表达；
- 没有提交前确认层。

建议：
- 保留 createProject 调用、上传逻辑和基本字段；
- 改成三步式流程：
  1. 基础信息
  2. 材料来源
  3. 提交前确认

结论：**保留重构**。

---

### C. 分析页
文件：
- `src/renderer/pages/bid-projects/analysis.tsx`

当前已有：
- summary card
- facts 分组
- source 列表
- detected fields
- risk hints
- 重新解析
- AI 生成入口

优点：
- 其实已经很接近我们当前原型里“材料分析 + 候选字段确认”的雏形；
- 页面职责清楚；
- 复用价值较高。

不足：
- 没有来源系统输入表达；
- 没有结构化资产来源表达；
- 没有轻量“问 AI”；
- 模板推荐层不够强；
- 信息层级需要重新设计。

建议：
- 保留“材料解析 + 候选字段 + 项目画像 + 风险提示”的思路；
- 继续扩到：
  - 模板推荐
  - 轻量问 AI
  - 资产来源解释
  - 来源系统表达

结论：**高价值保留重构**。

---

### D. 编辑页
文件：
- `src/renderer/pages/bid-projects/editor.tsx`

当前已有：
- 左侧章节导航
- 中间 MarkdownEditor
- 右侧多 Tab 面板
- 底部 compliance panel
- 章节级 AI rewrite
- docx 导出
- 应用修复建议

优点：
- 结构骨架已经对了；
- 基本上已经摸到了“左-中-右-底”这套正确布局；
- 复用价值很高。

不足：
- 右侧还是工具面板，不是 AI 助手工作区；
- 没有真实对话协同；
- 没有更清晰的“对话结果落回文档”；
- 引用依据透明层不足；
- 审查区和 AI 联动不够强。

建议：
- 保留三栏布局与底部审查区；
- 重构右侧为：
  - 对话
  - 动作
  - 依据 / 上下文
- 增强审查联动与来源资产表达。

结论：**高价值保留重构**。

---

### E. Renderer view model / storage adapter
文件：
- `src/renderer/pages/bid-projects/storage.ts`
- `src/renderer/pages/bid-projects/types.ts`

当前价值：
- 已经把 `IBidProjectDetail` 映射为 renderer 侧 `IBidProjectDetailView`；
- 已做了一层前端展示模型转换；
- 适合作为 view model adapter 保留。

问题：
- 当前有较多 demo 型派生逻辑，如：
  - `createClauseGroups()`
  - `createComplianceIssues()`
  - `createAnalysis()`
- 这些适合逐步被真实后端数据替代。

建议：
- 保留 adapter 层思想；
- 逐步把纯 demo 生成逻辑替换成后端真实字段；
- 继续让 renderer 层只做 view model 组装，不承担主业务规则。

结论：**保留重构**。

---

## 3.3 可废弃 / 降级为 fallback 的部分

### A. 联通直采整稿规则生成器
位置：
- `buildUnicomDirectProcurementMarkdown()`
- `buildUnicomDirectProcurementSections()`

价值：
- 证明了系统已经能从结构化字段拼出完整直采文档；
- 可作为联通直采模板的首个 fallback 版本；
- 可作为后续模板 adapter 样板。

问题：
- 太绑定联通直采；
- 太绑定单一章节结构；
- 不适合作为未来系统总生成器。

建议定位：
- 保留为：
  - `UnicomDirectProcurementTemplateAdapter`
  - 或规则 fallback renderer
- 不要再把它当平台中心生成逻辑。

结论：**不删，但降级为模板级 fallback**。

---

### B. 当前 regex 候选事实抽取逻辑
位置：
- `extractFactsFromText()`

价值：
- 让 MVP 能跑；
- 对常规文档字段抽取有一定可用性；
- 可以作为最小 fallback extractor。

问题：
- 字段覆盖少；
- 对复杂招标文档不够；
- 不足以承载真正的生产级事实抽取。

建议定位：
- 保留为 fallback；
- 后续叠加更丰富字段、文档类型差异化、模型辅助抽取、来源系统融合。

结论：**降级为 fallback，不作为核心抽取器。**

---

### C. 当前 AI section key 范围
当前：
- `notice`
- `technical`

问题：
- 明显不足以承载一期系统；
- 只能说明 AI section rewrite 通路是可行的。

建议：
- 保留逻辑框架；
- 全面扩展章节模型与 section key 管理。

结论：**逻辑可留，范围需重做。**

---

## 4. 最终复用策略建议

### 4.1 直接保留
- `src/common/bid-projects/types.ts`
- `src/process/services/bid-projects/BidProjectService.ts` 的主流程骨架
- `src/process/bridge/bidProjectBridge.ts`
- `src/common/ipcBridge.ts` 对应分组
- `src/process/database/schema.ts` 中现有 bid_* 表方向
- `src/process/database/migrations.ts` 的迁移体系
- `src/renderer/router.tsx`
- `src/renderer/layouts/components/Sider.tsx`

### 4.2 保留并重构
- `src/renderer/pages/bid-projects/index.tsx`
- `src/renderer/pages/bid-projects/new.tsx`
- `src/renderer/pages/bid-projects/analysis.tsx`
- `src/renderer/pages/bid-projects/editor.tsx`
- `src/renderer/pages/bid-projects/storage.ts`
- `src/renderer/pages/bid-projects/types.ts`

### 4.3 保留为 fallback / 样板
- `buildUnicomDirectProcurementMarkdown()`
- `buildUnicomDirectProcurementSections()`
- `extractFactsFromText()`
- 当前只支持 `notice` / `technical` 的 AI section rewrite 逻辑

---

## 5. 一期开发目标与边界

## 5.1 一期目标

在 Sudowork 内交付一个可真实演示、可继续演进的“招标文件编制工作台”，打通以下闭环：

1. 项目创建
2. 材料导入
3. 材料解析与候选字段确认
4. 模板推荐
5. 整稿生成
6. 编辑协作
7. 合规审查与修复
8. DOCX 导出

## 5.2 一期不做

- 投标文件智能解析
- 评标辅助
- 围串标检测
- 多人协作
- 审批流
- 第三方采购平台深度集成

## 5.3 一期平台表达要有，但不一口吃太多

一期前端需要把以下能力表达出来：
- 历史模板库
- 条款库
- 行业知识库
- 评审规则库
- 来源系统输入（上传文件为主，主数据/采购计划/历史项目为后续）
- 后续扩展路径（编制 → 投标解析 / 评标辅助 / 风险识别）

---

## 6. 一期开发 Plan

## Phase 0：冻结原型与领域方案

目标：
- 以当前已确认原型为基准，冻结一期交互范围
- 确认知识库体系与来源系统表达
- 明确联通直接采购模板为首个高质量模板目标

关键产物：
- 原型冻结版
- 知识库规划文档
- 一期范围清单

---

## Phase 1：模型与存储层升级

目标：
- 在现有 `bid_projects` 骨架上补齐一期真正需要的实体能力

主要工作：
- 扩展通用类型定义
- 设计并新增：
  - sections / section status
  - review issues
  - versions
  - citations / asset hits
  - source type（上传文件 / 主数据 / 历史项目等）
- 补 migration

关键文件：
- `src/common/bid-projects/types.ts`
- `src/process/database/schema.ts`
- `src/process/database/migrations.ts`

---

## Phase 2：主进程业务编排重构

目标：
- 把当前单模板、半 demo 的 `BidProjectService` 演进成一期可用的业务编排服务

主要工作：
- 拆 service 职责：
  - Project CRUD
  - Source parsing
  - Fact extraction
  - Template planning
  - Draft generation
  - Review & fix
- 保留当前 service 入口，逐步内部重构
- 把联通直采规则生成器降级为 template adapter / fallback
- 扩展 AI section rewrite 到更多章节

关键文件：
- `src/process/services/bid-projects/BidProjectService.ts`
- 后续建议新增子服务目录

---

## Phase 3：前端页面重构（按原型落地）

目标：
- 把当前 `bid-projects` 页面升级为与已确认原型一致的产品形态

主要工作：
- 列表页：项目工作台化
- 新建页：分步流程化
- 分析页：加入模板推荐、轻量问 AI、资产来源表达
- 进度页：新增生成状态页/状态区
- 编辑页：右侧 AI 助手工作区 + 引用依据 + 审查联动

关键文件：
- `src/renderer/pages/bid-projects/index.tsx`
- `src/renderer/pages/bid-projects/new.tsx`
- `src/renderer/pages/bid-projects/analysis.tsx`
- `src/renderer/pages/bid-projects/editor.tsx`
- `src/renderer/pages/bid-projects/storage.ts`
- `src/renderer/pages/bid-projects/types.ts`

---

## Phase 4：知识库与 RAGFlow 接入

目标：
- 把一期核心知识资产接入线上 RAGFlow

当前已确认：
- 线上 RAGFlow 服务可访问
- API key 可用
- 已有 8 个 KB 在线存在

主要工作：
- 盘点现有 `kb01-kb08` 与新知识体系映射
- 确认一期优先知识资产：
  - 模板
  - 法规
  - 技术参数
  - 合规规则
  - 评分办法
  - 资格条款
- 确定哪些直接复用，哪些重建/补充
- 接入检索链路到生成与审查环节

关键文件/外部依赖：
- `docs/plans/bid-workbench-knowledge-base-planning.md`
- 线上 RAGFlow：`https://rag.sudoprivacy.com`

---

## Phase 5：联调、自测与演示打磨

目标：
- 跑通黄金路径
- 保证一期演示和开发闭环可用

主要工作：
- 新建 → 上传 → 分析 → 确认 → 生成 → 编辑 → 审查 → 导出 全链路验证
- docx 导出验证
- 审查问题修复闭环验证
- 原型与实现一致性核对

---

## 7. 开发任务拆解

## 7.1 任务组 A：领域模型与数据库

### A1. 扩展 common types
- 扩展 `TBidProjectStatus`
- 新增 section / review / version / citation / source origin 等类型
- 统一 AI 助手上下文与知识资产命中结构

### A2. 扩展数据库 schema
- 新增或扩展：
  - `bid_project_sections`
  - `bid_project_review_issues`
  - `bid_project_versions`
  - `bid_project_source_origins`（如需要）
- 保持 migration 向前兼容

### A3. 编写 migration
- 在 `migrations.ts` 中增加对应版本升级逻辑

---

## 7.2 任务组 B：主进程服务重构

### B1. 保留并重构 `BidProjectService`
- 把核心入口保留
- 内部职责拆分

### B2. 提升材料解析
- 保留当前 fallback 解析
- 增加更丰富字段抽取
- 为来源系统输入预留接口字段

### B3. 模板规划
- 把当前硬编码模板逻辑抽成模板规划层
- 支持“联通直接采购模板”作为首个 adapter

### B4. 整稿生成与章节生成
- 保留现有 AI rewrite 通路
- 扩展 section key
- 接知识库检索结果

### B5. 审查与修复
- 把当前 renderer 侧 demo issue 逻辑逐步下沉到主进程

---

## 7.3 任务组 C：前端页面改造

### C1. 列表页
- 增加统计卡片
- 增加状态筛选
- 增加项目状态信息
- 增加平台能力入口表达

### C2. 新建页
- 分三步：
  - 基础信息
  - 材料来源
  - 提交前确认
- 保留上传逻辑
- 增加来源系统表达

### C3. 分析页
- 保留 facts + sources
- 增加模板推荐区
- 增加结构化资产来源展示
- 增加轻量“问 AI”入口

### C4. 生成进度页
- 新增独立页面或统一状态区
- 展示阶段进度、章节规划、日志摘要、知识资产命中说明

### C5. 编辑页
- 保留三栏布局
- 右侧改成 AI 助手工作区：
  - 对话
  - 动作
  - 依据 / 上下文
- 增强“对话结果落回文档”动作
- 增强审查区与 AI 联动

### C6. 导出弹层
- 增加版本选择
- 增加风险提醒
- 增加导出选项

---

## 7.4 任务组 D：知识库建设与接入

### D1. 对照现有 kb01-kb08
- 看哪些直接复用
- 哪些要补语料
- 哪些要重新命名/重组

### D2. 一期知识资产优先级
P0：
- 模板库
- 法规库
- 技术参数库
- 合规规则库
- 评分办法库
- 资格条款库

P1：
- 历史项目库
- 常用条款库

### D3. 接入 RAGFlow
- 查询策略
- dataset 命中策略
- 生成与审查的 query 组装

---

## 7.5 任务组 E：测试与演示

### E1. 单测补齐
- 补 service 层用例
- 保留现有 `tests/unit/bidProjectService.test.ts` 基础，继续扩

### E2. 前端交互验证
- 验证原型对齐实现
- 验证黄金路径

### E3. 导出验证
- 验证 DOCX 可打开、结构正确

---

## 8. 推荐开发顺序

### 第一步
- 模型与数据库补齐
- 明确一版正式类型

### 第二步
- 重构主进程服务
- 先把 create / parse / confirm / generate 的骨架稳定住

### 第三步
- 先做前端新建页、分析页、列表页
- 保证生成前闭环顺畅

### 第四步
- 做编辑页与 AI 助手工作区
- 做审查与修复闭环

### 第五步
- 接知识库检索与平台感表达
- 打磨导出与演示

---

## 9. 建议当前不要做的事

- 不要拆新 repo
- 不要删掉 bid-projects 现有骨架
- 不要把联通直采规则生成器继续当成总方案
- 不要在一期同时展开投标解析 / 评标辅助 / 风险识别开发

---

## 10. 最终建议

当前最优路线是：

> **基于 Sudowork 当前 `bid-projects` 模块继续演进，保留底层骨架，重构交互层，升级知识库接入，先把“招标文件编制工作台”一期打透。**

这比重新起一个新系统成本更低，也更符合当前产品阶段。
