# 外部智能体：组织目录、统一对话与接入管理

2026-10-13 更新。管理员发布并授权的 Dify 智能体展示在侧栏 **智能体列表 → 组织发布的智能体**，点击 **开始对话** 后进入共用对话布局。管理员统一管理智能体；每位用户只看到自己的会话。组织智能体不进入 **我的 Agent**，也不作为个人模板出现在目录的 **我的智能体 / 已安装模板** 页签。

## 管理员操作

1. 打开 **智能体列表 → 外部智能体管理 → 配置试点范围**。平台管理员启用当前组织并保存获准的 Dify `/v1` 地址。
2. 组织管理员点击 **接入 Dify 智能体**，输入 App API Key 并测试连接。
3. 填入 Dify App/Workspace ID、上传 YAML/JSON 定义，选择本组织用户，填写审核说明，保存待审核配置。
4. 核对 Dify 当前发布定义，点击 **审核发布** 并选择有效期（1/3/7天）。授权用户随后可在智能体列表开始对话。
5. 后续可测试连接、编辑配置、更换密钥、停用或归档；编辑与换密钥会撤销发布状态，必须再次审核。归档保留历史和加密凭据。

不需要为单个智能体修改环境变量、手工创建 Secret 引用、计算摘要或调用 API。部署前仍需让 Moss 连接到可写 Nexus Secret；页面会提示凭据服务不可用。普通用户没有管理入口，Moss 也独立校验每次管理和执行请求的权限。

## 用户操作

1. 登录后进入 **智能体列表**，在 **组织发布的智能体** 找到获准使用的智能体，点击 **开始对话**。目录搜索也适用于该区域。
2. 在底部输入框输入合成测试问题。Enter 发送，Shift+Enter 换行；回答在消息区增量展示，可复制。
3. 同一会话继续追问，复用 Dify conversation。左侧 **对话 → 最近 / 今天等时间分组** 可找回历史；刷新或在另一宿主登录同一账号仍可继续。
4. 顶部 **新建会话** 开启该智能体的新会话。停用、审批到期或撤销授权后，自己的既有历史仍可读取，禁止新派发。

示例：发送“6乘7，只返回数字”得到 42，再发送“上次结果加8，只返回数字”得到 50。模型由管理员在 Dify 中配置，当前不提供本地模型切换、附件、工作区、本地工具或远端停止按钮；返回的 actions 不执行本机操作。

外部历史当前支持查看和续聊，暂不支持重命名、置顶、删除、批量删除或导出。批量操作模式下这些条目不可选，避免被传给原生会话接口。提交响应不明时保留原幂等 key 核对；unknown 会话只读；读取事件失败后的刷新只重读结果，不重新派发。

旧链接 `/app/agents/external?session=<id>` 自动跳转统一对话，无 session 的旧入口跳转智能体列表。独立的“外部智能体（试点）”侧栏入口已移除。

## 实现边界

- Desktop：IPC `external-providers.*` → `mossExternalProviders` → 当前账号 Moss 地址/令牌（Electron net.fetch）；账号切换拒绝迟到响应。
- WebUI：相同 IPC 契约 → mossAdapter → 管理/用户接口白名单代理 → Session 的 Moss 上下文。
- 客户端会话地址为 `/conversation/external%3A<session-id>`。通过 renderer 只读投影合并时间线，外部 Session/Task 的事实源仍在 Moss，不伪造 ACP 会话或复制到原生会话数据库。
- 页面复用 ChatLayout，能力由外部执行方决定；消息不解释本地文件/action 标记，也不自动加载 provider 图片。
- `@sudowork/moss-client/external-providers` 使用运行时 schema 验证结果。密钥保存在服务端 Nexus Secret，用户执行不持有 Dify key。
- 契约语义源在 Moss，经 sudostack experimental 派生。`bun run check:external-contract` 校验来源与 digest；本轮 UI 整合未变更稳定 contracts exports 或外部任务 API。
- Moss 旧可安装模板及 enhancement 路径排除 `external_hosted`，避免组织智能体同时出现安装和直接对话两条入口。

## 验证记录

本轮使用完整 WebUI、完整 Moss、真实 Nexus 和已发布 Dify 应用验证目录进入对话、42→50、左侧历史、刷新恢复、旧链接兼容和普通用户隔离。另以完整 Electron 开发应用验证桌面 IPC、跨宿主历史及续聊，证据见配套 Moss 分支的 `docs/external-provider-pilot/evidence/unified-*.json` 与截图。开发应用验收不等于生产安装包验收。

自动检查和真实联调的最终结果、既有基础设施边界见配套 Moss 分支 `docs/external-provider-pilot.md`。本地启动配置和操作入口见 `~/.local/share/dify-pilot-20261012/manual-verification.md`。本轮验收结束后恢复服务停止状态，保留测试数据。
