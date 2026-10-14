# 外部智能体：Moss 组织管理与 SudoWork 对话

2026-10-14 更新。管理员在 **Moss → 智能体管理 → 专属智能体** 接入和发布外部智能体；授权用户在 **SudoWork → 智能体列表 → 专属智能体 → 外部托管** 开始对话。桌面端和 WebUI 页签统一为 **智能体库 / 专属智能体 / 我的智能体**，专属页分为 **外部托管 / 内部托管**。组织发布的外部智能体不进入“我的 Agent”或“我的智能体”。

## 组织管理员操作（Moss）

1. 登录 Moss 后打开 **智能体管理 → 专属智能体**。页面分别展示 **外部托管** 和 **内部托管**。外部托管分区提供 **接入外部智能体**；内部托管分区提供 **创建智能体** 及对应筛选项。内部托管沿用原生执行能力，外部托管沿用平台适配器。
2. 首次部署时，平台管理员在 **配置接入范围** 启用当前组织并保存允许的 Dify `/v1` 地址；组织管理员只读该范围，负责组织内部接入和发布。
3. 点击 **接入外部智能体**，选择 **外部托管 / Dify** 和服务地址，输入应用的 App API Key，点击 **测试连接并继续**。
4. 填写 App ID、Workspace ID，上传当前发布的 YAML/JSON 定义，选择组织成员和结果格式，填写审核说明，点击 **保存待审核配置**。
5. 在条目上点击 **审核发布**，核对定义、授权用户，选择1/3/7天有效期并确认。授权用户随后可在 SudoWork 的专属智能体中使用。
6. 后续可 **测试连接、编辑配置、更换密钥、停用、归档**。编辑或换密钥会撤销发布，必须重新审核。停用阻止新派发，已派发任务不会因此取消；归档保留历史和加密凭据。

Moss 使用已有 `external-agents/admin` 与 review 接口，凭据仍存放 Nexus Secret，原数据无需重建。网络接入范围由平台管理员维护，普通用户无外部管理入口。权限由后端独立校验；切换组织或账号会清空表单并取消旧请求。原生模板创建接口与外部接入接口相互独立。

## 用户操作（SudoWork）

1. 打开 **智能体列表 → 专属智能体**，在 **外部托管** 分区选择已授权智能体，点击 **开始对话**。目录搜索适用于外部智能体。
2. 在底部输入合成测试问题。Enter发送，Shift+Enter换行；回答在消息区增量显示，可复制。
3. 同一会话继续追问，复用 Dify conversation。左侧 **对话 → 最近 / 今天等时间分组** 可找回历史，刷新或跨 WebUI/桌面登录同一账号可继续。
4. 顶部 **新建会话** 开启独立会话。审批到期、停用、撤销授权后的个人历史仍可读取，禁止新派发。

例如发送“6乘7，只返回数字”得到42，再发送“上次结果加8，只返回数字”得到50。模型与工具在 Dify 发布配置中确定；客户端不提供不支持的本地模型切换、附件、工作区、工具或停止按钮，不执行返回的 actions。

外部历史暂不支持改名、置顶、删除、批量删除或导出。批量模式不可选，避免被传入原生会话接口。提交响应不明时保留原幂等 key 核对；unknown 会话只读；读取事件失败的刷新只重读，不重新派发。

旧 `/app/agents/external?session=<id>` 自动跳转统一对话，无session则跳到智能体列表。SudoWork中已删除接入管理组件，桌面/WebUI桥接管理API保留兼容性，不新增另一套管理数据。

## 实现与验证

- Desktop：`external-providers.*` IPC → Moss HTTP；WebUI：同一IPC契约 → Session代理 → Moss。当前账号/组织和权限均由真实令牌限定。
- 会话路由 `/conversation/external%3A<session-id>`。renderer只读投影合并时间线，外部Session/Task事实源仍在Moss，不复制为ACP或原生会话。
- 页面复用ChatLayout，provider内容不解析成本地action/file标记，也不自动加载远端图片。
- Moss原生模板列表、规则详情与兼容Hub/enhancement路径排除`external_hosted`，消除重复下载入口和规则404。
- 外部契约仍为Moss语义源，经sudostack experimental派生。本轮未改变任务API、稳定exports或已有智能体/会话数据。

自动检查与完整Moss后台 → SudoWork → 真实Dify的验收记录见Moss工作树 `docs/external-provider-pilot.md` 及 `docs/external-provider-pilot/evidence/moss-management-migration-result.json`。WebUI真实对话42→50，完整Electron开发应用对话7×8→56并刷新恢复历史，桌面记录为同目录的 `moss-management-desktop-result.json`。管理入口迁移阶段SudoWork全量3187项通过、36项跳过；类型检查与外部契约摘要校验通过。生产安装包和Moss任务库PG/多副本验收仍未覆盖。

本地入口、测试账号与启动状态见 `~/.local/share/dify-pilot-20261012/manual-verification.md`。本轮按用户要求先停服务修改，完成后重新启动并保留运行。


## 2026-10-13 PR 构建检查修正

PR #1234 的干净构建暴露两个遗漏：WebUI 三个文件未按该应用的 Prettier 配置格式化；Electron main 的源码别名漏掉 `@sudowork/contracts/external-provider`。本地已生成的 `packages/contracts/dist` 让后者未在此前联调中出现；macOS/Windows 生产构建与 Linux dev shim 均在相同 import 处失败。

已补齐契约源码别名，保持桌面从源码打包的既有方式。新增 `tests/integration/externalProviderBuild.test.ts`，读取正式生产配置并实际打包外部客户端，同时拒绝读取 `contracts/dist`；修复前失败，修复后通过，避免已有本地产物掩盖回归。完整生产 main bundle 同样在禁止读取契约 dist 的条件下构建通过。

WebUI 已按 CI 顺序通过类型、lint、格式、单元 239 项、契约 46 项和 PostgreSQL 集成 88 项检查；集成测试使用单独临时容器，未操作现有试点数据库。desktop 类型及变更文件 lint/格式通过；修复后根 `bun run test --maxWorkers=1` 全量 3137 项通过 / 30 项跳过（含新增构建回归）。CI 最终状态见 [PR #1234](https://github.com/sudoprivacy/sudowork/pull/1234)，本地 main 构建通过不代表生产安装包已验收。


## alpha4 升级与本轮评审修复

当前客户端消费固定 SudoStack 产物中的 `external-provider.sudo.dev/v1alpha4`，三仓来源与产物由锁文件及 CI 核对；不等于正式 Task/Agent 契约已 Accepted。

桌面、浏览器到 WebUI、WebUI 到 Moss 均使用 15 秒总请求期限，包含身份获取、401 刷新和响应读取。超时返回 `EXTERNAL_TASK_TIMEOUT`，身份变更返回 `EXTERNAL_IDENTITY_CHANGED`。401 最多刷新一次，保留原 request body 和幂等 key；超时后不自动重放任务。

Moss 现在要求完整定义（包含 workflow.features），仅准入 Start → LLM → Answer 的 query-only profile；旧条目需在 Moss 编辑、重新上传定义并审核。上传摘要不能证明 Dify 执行了不可变版本。alpha3 历史可恢复为 alpha4 快照并保留完整原文；alpha2 缺失原文仍为 legacy_checkpoint。协调升级两端，不用创建新任务修复版本读取错误。
