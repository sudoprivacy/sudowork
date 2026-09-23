# Sudowork / Moss 本地与云端执行：实现及验证记录

初次验收日期：2026-09-22。当时两仓库均未提交、未推送；后续授权修复及提交前验证见文末。

| 仓库 | 分支 | 建分支时的 origin/dev |
| --- | --- | --- |
| Sudowork | `codex/moss-managed-local-execution` | `f0ecf394` |
| Moss | `codex/moss-managed-local-execution` | `11c7571` |

## 实现

- Moss 默认开放本地、云端，默认选择本地；执行权限与 `localAuth` 分离。
- 登录和 `/api/v1/client/local-runtime` 返回当前用户的个人模型配置。个人 Key 缺失时返回未就绪状态，不下发组织共享 Key。凭据响应禁止缓存。
- Sudowork 主进程应用模型配置；登录结果不再把新增的托管模型 Key 传给 renderer。账号切换停止旧执行器，退出时恢复登录前配置，并同步清理或恢复 Nexus 凭据。
- 本地会话使用 ACP/scode，本机保存工作目录、消息与恢复状态；云端会话继续由 Moss 执行。记录执行位置和账号归属，按会话自身的字段读取、更新、删除和恢复，不依赖首页当前模式。
- 新增会话归属覆盖普通入口及直接调用会话服务的入口。旧云端记录由 Moss 确认用户和组织归属后关联到当前账号；无法确认归属的旧记录保留原数据，不自动归给新账号。
- 智能体及依赖技能按需下载，校验 SHA-256，检查 ZIP 路径、符号链接和大小，临时目录解包后原子发布。缓存按身份和内容摘要分区，会话保留资源快照。使用时检查资源授权与快照，运行中新增技能也经过准备流程。
- ZIP 输出固定时间戳和排序，保留脚本可执行权限。下载失败或资源不兼容时提示原因，保留用户选择的本地模式。

本地执行指会话、工具和工作区在本机；模型请求仍使用个人 Key 访问模型服务，登录和资源目录/下载仍访问 Moss。

## 实际验证环境

Moss：`http://127.0.0.1:43147`，host/scode runtime。模型网关使用用户提供的 Sudorouter 测试环境。创建测试用户 `localcloud0922`，由 Moss 为其分配个人 Key，并补充测试额度。验证模型为 `gpt-5.4`。

测试密码、管理 Token、个人 Key 均在仓库外的私有测试配置中，没有写入源码或本记录。源码差异的凭据扫描通过。

## 实机结果

| 验证项 | 结果 |
| --- | --- |
| Sudowork 密码登录 | 成功；首页默认选中本地执行 |
| 本地聊天 | 会话 `87f1fc94` 回复“本地会话正常。”；`type=acp`，`executionTarget=local`，无 Moss session ID |
| 云端聊天 | 会话 `9aff27a1` 回复“云端会话正常”；`type=remote-agent`，对应 Moss session `71632516-b8ad-4f1f-a00b-874eec367fc3` |
| 首页选云端后继续本地旧会话 | 回复“本地恢复正常”，仍使用原本地会话 |
| 首页选本地后继续云端旧会话 | 回复“云端恢复正常”，仍使用原 Moss 会话 |
| 重启 Sudowork | 登录恢复成功，旧会话可继续使用 |
| 无缓存智能体与技能 | 下载 `Local Proof Agent` 及 `local-proof`，会话 `5e60aab0` 在本地生成 `local-proof.txt`，内容 `LOCAL_RESOURCE_OK` |
| 本地执行不创建云端会话 | 首轮本地测试后 Moss 会话数为 0；创建两次云端测试后为 2，此后的本地资源执行和续聊未增加数量 |
| 资源内容校验和稳定版本 | 下载内容 SHA-256 与响应头一致；间隔重新下载摘要相同 |
| 退出与重新登录 | 个人 Key 从 scode 配置移除，登录前配置恢复；重新登录仍默认本地 |
| 旧云端历史兼容 | 在测试记录上去除新增归属字段，Moss 验证归属后成功恢复为当前账号云端记录 |

截图：

- [登录后默认本地](/tmp/codex-sudowork-local-execution/default-local.png)
- [本地聊天](/tmp/codex-sudowork-local-execution/local-clean.png)
- [云端聊天](/tmp/codex-sudowork-local-execution/cloud-clean.png)
- [智能体和技能在本地生成文件](/tmp/codex-sudowork-local-execution/resources-success.png)
- [本地会话恢复](/tmp/codex-sudowork-local-execution/local-resume.png)
- [云端会话恢复](/tmp/codex-sudowork-local-execution/cloud-resume.png)

## 自动检查

- Sudowork `bun run test`：**2584 通过，11 跳过**，246 个测试文件通过。
- Sudowork desktop、renderer 的 `tsc --noEmit` 通过；`bun run build:packages` 全部共享包构建通过。
- 修改文件的 ESLint、桌面与 renderer 格式检查通过；`git diff --check` 通过。
- Moss `bun run test`：各 runner 合计 **1210 通过，7 跳过**。现有 runner 仍排除 `runtimeServiceFencing.test.ts`、`lbOwnerRoute.test.ts` 两个文件，原因是 Bun/Node 导入兼容性，不属于本次新增排除项。
- Moss `build:node` 通过；`typecheck` 的既有基线检查通过：server 105 条，基线 112 条。该仓库目前采用类型错误基线，并非全仓零类型错误。

测试环境修复：为 LB 健康检查 fixture 分配独立端口，避免探测到开发机正在运行的 Nexus；将本机陈旧的 `@sudo/contracts 0.1.0` 安装更新为 dev 已锁定的具体提交。没有修改依赖声明或锁文件。

## 已知范围

本轮完成普通本地 scode 会话、规则/资源/技能下载及云端兼容闭环。依赖服务端 wiki、企业应用、工作流或未适配 MCP 的智能体需要继续选择云端，不能仅凭下载 ZIP 保证本地可运行。当前 scode 配置支持一个活跃的托管身份。

实机登录覆盖密码与恢复登录；短信、OAuth 等依赖外部认证环境，没有在本测试环境逐一实测。组织/账号隔离、凭据缺失、资源损坏与撤销等由自动测试覆盖。

测试过程中 `gpt-4.1-mini` 拒绝了当前 scode 请求中的 `reasoning_effort` 参数；成功验收使用兼容的 `gpt-5.4`，不据此宣称网关中的全部模型均已验证。

## 2026-09-23：逐用户 Local 授权补齐

管理页面的“Local 授权”现在控制独立的 `local_execution_allowed`，不再改动密码身份字段 `localAuth`。管理员新增、邀请码注册以及其他创建用户的路径默认授权；SQLite 和 PostgreSQL v9 迁移一次性保留已有用户的授权值，后续启动不会覆盖管理员的撤销操作。

组织管理员根据数据库中的真实身份，只能撤销/恢复本组织用户；超级管理员可操作任意组织用户。Moss 每次生成执行能力时读取最新用户权限，撤销后返回 `isLocalAllowed=false`、默认云端且不下发个人模型 Key。Sudowork 登录后隐藏本地执行入口，创建本地会话及发送消息前再次检查服务器权限，包括已有本地执行器。相同身份的权限变化只清理本地执行器，保留云端连接。

实机测试还发现 IPC provider 抛错不会自动回传 renderer，导致本地准备提示一直显示；创建会话接口已改为显式错误响应，调用方恢复按钮、保留草稿并显示失败原因，补充了对应 UI 回归测试。

| 验证项 | 结果 |
| --- | --- |
| 管理员创建 `localgrant0923` | 默认允许本地执行，个人模型配置就绪 |
| 撤销后使用原 access token | 最新运行配置拒绝 Local、无个人 Key，云端仍允许 |
| 撤销后重新密码登录 | 成功；默认云端，密码身份不变 |
| 恢复授权 | 原 token 再次获取到可用本地配置 |
| 组织管理员管理本组织用户 | 撤销成功，HTTP 200 |
| 组织管理员管理其他组织用户 | HTTP 404，目标权限不变 |
| 超级管理员跨组织操作 | 无需切换组织即可撤销、恢复，HTTP 200 |
| 邀请码注册 `invitelocal0923` | 注册成功，归属邀请码对应组织，默认 Local 授权；该新建测试组织尚无可用模型目录，未据此声称已完成模型调用 |
| Sudowork 撤销后的真实页面 | 仅显示“云端执行”，无“本地执行”选项 |
| Sudowork 恢复授权并刷新 | 重新显示本地、云端两个选项 |

本轮最终检查：

- Sudowork 全量测试：**2591 通过、11 跳过**（247 个测试文件通过）。此前并行运行有 3 项本体工作台测试超时，单 worker 全量重跑全部通过，未放宽超时或修改相关测试。
- Sudowork desktop、renderer 的 `tsc --noEmit` 通过；相关改动文件 ESLint 无错误，Prettier 检查通过。
- Moss 全量测试：**1214 通过、7 跳过**；独立 PostgreSQL 16 数据库测试另外 **34 项通过**，覆盖迁移、默认授权、保留撤销和重复运行迁移。
- Moss Node 构建、管理页面构建以及既有类型基线检查通过；仍有仓库原有类型错误基线，未宣称全仓零错误。
- 两仓库 `git diff --check` 和测试凭据扫描通过，无提交、无推送。

Moss 继续运行于 `http://127.0.0.1:43147`，Sudowork 测试桌面保持启动。测试期间临时撤销的 admin Local 权限已恢复，跨组织测试成员也已恢复授权。权限检查约束的是托管桌面的创建/发送操作；不等同于在模型网关撤销已复制到桌面外使用的个人 Key。

## 用户验收后的 dev 同步

2026-09-23 用户确认测试通过并授权提交。两个功能分支均执行 `git rebase origin/dev`：Sudowork 的 dev 仍为 `f0ecf394`；Moss 更新到 `d22a84a`，包含 Nexus 启动状态分类、重试退避及 VFS 客户端 0.3.2 更新。无冲突，Moss 依赖使用 `bun install --frozen-lockfile` 按最新 dev 同步。只提交本功能代码、测试及两份相关设计/验收文档；本地环境配置与其他未跟踪文件保留在工作区。

rebase 后提交前全量测试：Sudowork **2591 通过、11 跳过**，Moss **1215 通过、7 跳过**（比上轮多出的 1 项来自 dev 更新）。Moss Node 构建及类型基线检查再次通过，两仓库暂存区的空白错误及测试凭据检查通过。没有执行推送。
