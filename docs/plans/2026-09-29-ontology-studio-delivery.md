# 本体工作台首期实施记录

本次按 Review v3 实施首期工作台重构。原方案中的多轮自主构建、完整证据/业务问题管理和持续治理属于后续阶段，不能将本次交付理解为全部路线图已完成。

## 已实现

- 本体库与独立工作区，按“建模、数据、能力、检查、发布”组织页面。
- 建模页左侧本体对话、右侧图编辑器；分栏可调整，对话可收起，其他页面可独立使用完整内容区域。
- 图中新增/编辑对象和属性、拖拽创建关系、继承关系、结构视图、搜索、自动布局、撤销/重做、选中详情和变更高亮。
- 本地未保存编辑缓存、显式保存、模型 revision 和冲突提示；后台更新不会直接覆盖未保存内容。
- `.rdf` / `.owl` 的 RDF/XML 导入导出，以及 OWL/XML 的解析和导出；导入预览、完整 IRI 身份、多语言标签、实例断言及未显示公理的保留。
- 数据文件和数据库来源接入、数据预览、字段映射；函数编辑、参数配置和试运行；检查与候选版本发布；已发布版本导出和助手注册。
- 本体会话复用 Sudowork 的运行时、消息、附件、模型和 skills 发送链路。通过用途标记从普通会话列表、分组和标签中隔离，内部会话历史仍可管理。
- 会话重新打开时刷新本体 MCP 连接配置；中断的会话注册可依据持久化归属恢复。
- MCP 写入绑定本体范围、拒绝跨本体写入和构建期自动发布/业务动作；成功修改通知工作台实时刷新。
- 新数据使用应用数据目录下的 `ontology-studio/studio.db`。旧本体数据不迁移、不清理。存储支持事务、版本冲突、操作去重及删除后拒绝旧快照写回。

## 验证

- 全量单 worker 回归：**2684 通过、10 跳过**，260 个测试文件通过、4 个跳过。
- 所有共享包构建通过；桌面端和 Renderer 的 `tsc --noEmit` 通过。
- 改动 TypeScript 文件均执行文件范围内 ESLint；无 lint 错误，保留少量既有告警。
- 完整桌面生产构建通过；最后的存储/会话修正又通过主进程与 preload 构建。
- 覆盖标准文件交换、独立 RDF 实现读取、SQLite 事务/冲突/幂等、删除后拒绝旧快照、MCP 范围检查、会话注册恢复及工作区 DOM 交互。

首次并发全量回归有两项旧工作台 DOM 测试超时；没有修改超时标准，单 worker 全量回归通过。

浏览器检查使用真实工作区组件和隔离的验证 API，验证了拖拽连线、关系编辑、撤销/重做及保存反馈。没有调用真实模型，也没有在用户业务数据库中执行写入。

## 当前边界

- RDF/XML 导出保留该语法可表达的完整语义图，不可表达的 IRI 或字符会明确报错。OWL/XML 支持常用构造，并保留从 OWL/XML 导入的复杂公理；遇到不能完整转换的结构会明确拒绝导出，提示使用 RDF/XML，不静默丢弃语义。
- XML DTD/实体声明不在当前导入范围中。单文件上限为 5 MB。
- `owl:imports` 声明会保留并显示，目前不自动下载外部本体或执行完整 OWL 推理。
- 当前构建使用现有会话与本体工具。独立构建任务状态机、证据链、业务问题闭环、完整业务验收与动作审批仍按方案后续阶段推进。
- 真实模型/账户下的完整构建会话尚未联调。浏览器交互检查与本地协议、存储测试不替代真实模型验收。

## 查看与运行

在仓库根目录运行 `bun run start`，从“本体工作台”进入新界面。开发启动脚本会构建本体 MCP 资源。

核心代码：

- [工作区入口与页面装配](/Users/zhangdongdong/sudo/projects/ai-sudo/sudowork/packages/renderer/src/pages/ontology/index.tsx)
- [本体工作区](/Users/zhangdongdong/sudo/projects/ai-sudo/sudowork/packages/ontology-ui/src/studio/OntologyStudio.tsx)
- [图编辑器](/Users/zhangdongdong/sudo/projects/ai-sudo/sudowork/packages/ontology-ui/src/studio/StudioModelEditor.tsx)
- [本体专属会话](/Users/zhangdongdong/sudo/projects/ai-sudo/sudowork/packages/renderer/src/pages/ontology/StudioConversationPanel.tsx)
- [标准语义与编辑投影](/Users/zhangdongdong/sudo/projects/ai-sudo/sudowork/packages/ontology-common/src/studio.ts)
- [标准文件编解码](/Users/zhangdongdong/sudo/projects/ai-sudo/sudowork/packages/ontology-engine/src/standardOntology.ts)
- [独立存储](/Users/zhangdongdong/sudo/projects/ai-sudo/sudowork/apps/desktop/src/process/services/ontology/OntologyStudioDatabase.ts)
