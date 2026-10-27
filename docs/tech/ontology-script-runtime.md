# 本体脚本运行与导出

完整包导入、编辑恢复、环境绑定与最新契约见 [Sudowork 本体包（.sudoonto）](./sudoonto-package.md)。

本体工作台通过统一 CLI 执行能力。本地调试、本地注册智能体和导出的运行包使用相同的能力实现；运行包不依赖 Electron、本地工作台数据库或本体 MCP Server。

普通 MCP、浏览器 MCP、团队 MCP、技能商店及普通会话仍使用原来的机制。

## 本地工作流

1. 在工作台建立对象、关系、映射、函数和动作。
2. 保存相关模型或能力修改时构建工作稿脚本产物。
3. 能力页面的运行按钮启动该产物内的 CLI，返回结构化结果。
4. 创建候选版本时固定模型、能力脚本和资源契约，并记录 runtimeDigest。
5. 审批发布沿用候选版本的已构建产物。注册智能体后，通过现有 bash／命令工具调用该版本。
6. 在发布页选择“导出运行包”，选择是否携带本地文件或完整 SQLite 数据库快照。

不迁移旧的本体 MCP 发布产物。原工作台数据不会被自动删除；需要创建新的候选版本并发布，才能使用脚本运行和运行包导出。

AI 建模通过 project 命令调用本地、项目限定的编辑接口。该接口复用现有事务和修订检查，不是 MCP 服务，也不承担运行包的业务执行。新建、标准文件导入、本体包导入和数据库接入统一进入同一种工作台，不需要配置 Sudograph 编译器。

## 运行包

默认文件扩展名为 .sudoonto，解压后包含：

~~~text
manifest.json
authoring/project.json
ontology/model.rdf
ontology/runtime-model.json
capabilities/catalog.json
capabilities/implementations/*
scripts/ontology.cjs
agent/definition.json
agent/AGENT.md
environment/resources.json
environment/bindings.example.json
environment/bindings.schema.json
environment/runtime.lock.json
verification/export-report.json
checksums.json
assets/*                         # 仅在选择携带数据时存在
~~~

- SQL、JS、Python 函数的代码包含在能力实现中。
- SQL 动作和已识别解释器的自定义脚本会固定其实现；Node、Python、shell 脚本资源按包内路径加载。
- 未能自包含的程序、接口及通知通道保留为显式资源绑定，不能声称已经具备目标环境。
- 连接凭据不随包导出。结构化动作配置中的凭据保存为绑定槽位；不要在源码字符串中硬编码凭据。
- SQLite 快照使用一致性备份，包含整个源数据库。嵌入快照默认只读；需要写入时，应在包外创建可写数据副本并重新绑定。
- 包内文件、能力实现及资源契约均校验摘要。只重新生成 checksums.json 不能伪装成原发布版本。
- 调用次数和最近运行时间不参与运行内容摘要。

运行产物与分发包是两个层次：runtimeDigest 标识固定的定义、实现和运行要求；分发包摘要还覆盖所选择的数据附件及导出报告。

## 环境要求

CLI 使用 Node.js 22.22.2 或更新的兼容运行环境，并要求 node:sqlite 的备份 API。SQLite 不再依赖 Electron ABI 的本体专用原生模块。

数据库 JavaScript 驱动包含在 CLI 中；Oracle 使用 thin 模式。实际远程数据库连接仍需目标网络、相应数据库版本和有效账号。

Python 能力需要目标环境提供兼容的 Python，bindings.python 可指定解释器路径。shell 脚本需要对应的 shell 环境。运行包不会自动安装依赖、启动 MCP 或下载运行环境。

请以 environment/runtime.lock.json 和能力声明确认运行要求。平台未提供所需解释器、文件或数据连接时，先完成配置，再执行能力。

## 独立使用

保持解压后的包只读。绑定文件、请求文件和业务输出放在包外，避免改变受校验的文件清单。

~~~bash
cd northwind
node scripts/ontology.cjs inspect --package .
node scripts/ontology.cjs list --package .
node scripts/ontology.cjs describe logic.sales_report --package .
~~~

需要外部连接时，将示例复制到包外并填写：

~~~bash
cp environment/bindings.example.json ../bindings.json
node scripts/ontology.cjs validate --package . --bindings ../bindings.json
~~~

调用输入示例，保存为包外的 request.json：

~~~json
{
  "protocolVersion": 1,
  "requestId": "example-001",
  "arguments": {}
}
~~~

~~~bash
node scripts/ontology.cjs invoke logic.sales_report \
  --package . --bindings ../bindings.json --input-file ../request.json
~~~

没有外部绑定需求时可省略 --bindings。也可以通过 stdin 提交同样的 JSON。stdout 只返回结构化结果，诊断日志写入 stderr。

validate／verify 检查完整性与绑定。关系数据库会对比字段结构，文件会检查可访问性；其他来源标记为仅检查绑定，不声称已完成远程业务验证。各资源的验证范围写入导出报告。这些检查不执行任意业务写动作，也不替代对具体业务参数的功能验收。

能力目录中的 resourceRefs 声明各能力需要的资源。invoke 只要求当前能力及其函数依赖的绑定；未配置通知通道等无关资源时，已具备数据绑定的查询仍可执行。validate／verify 则检查整套环境。

## 授权与失败处理

运行绑定中的 allowedActions 显式列出允许执行的动作 ID，数据库写入还需要连接的 writable 授权。包内数据禁止作为可写数据库使用。

CLI 是执行协议，不是租户隔离设施。未来 Moss 必须提供按调用权限配置的数据账号、文件可见性及执行环境，不能向普通用户可任意执行命令的环境暴露管理员全权限凭据。

修改请求中的租户或用户标识不能改变宿主授权；业务数据访问仍以目标环境提供的数据库权限为准。

写操作超时后可能已经产生副作用。遇到 EFFECT_OUTCOME_UNKNOWN 或类似状态时，应检查业务结果，不能自动重放。

本地桌面通知通过宿主提供的通知资源绑定交付；导出包不携带该临时地址。部署到服务器后，需要为通知能力配置服务器端通知接口。

## 开发与验证

~~~bash
bun run build:packages
cd apps/desktop
bun run ontology-cli:build
bunx vitest run tests/unit/ontologyScriptPackage.test.ts \
  tests/unit/ontologyProjectCli.test.ts \
  tests/unit/ontologyAgentToolRoundtrip.test.ts \
  tests/unit/ontologyPackageExport.dom.test.tsx
~~~

开发启动和生产构建入口会构建 CLI；Vitest 的测试准备也会构建，直接运行测试无需依赖已提交的生成文件。

核心回归覆盖：移走原数据库和原产物后的独立运行、数据快照、代码和资源契约校验、凭据分离、取消导出、脚本源文件固定、普通 MCP 配置保留，以及真实 Sudocode 通过 bash 调用 CLI 和恢复会话。

Moss 本体库、上架、部署管理和租户发布流程不属于本轮实现。
