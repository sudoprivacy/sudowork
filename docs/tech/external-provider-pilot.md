# 外部智能体：接入管理与用户执行

侧栏 **外部智能体（试点）** 对应 `/app/agents/external`。桌面与 WebUI 使用相同的管理、执行页面。

## 管理员操作

1. 平台管理员打开 **外部智能体管理 → 配置试点范围**，启用当前组织并保存获准的 Dify `/v1` 地址。
2. 组织管理员点击 **接入 Dify 智能体**，输入 App API Key 并测试连接。
3. 填入 Dify App/Workspace ID、上传 YAML/JSON 定义，选择本组织用户，填写审核说明，保存待审核配置。
4. 核对 Dify 当前发布定义，点击 **审核发布** 并选择有效期（1/3/7天）。授权用户随后可选择使用。
5. 后续可测试连接、编辑配置、更换密钥、停用或归档；编辑与换密钥会撤销发布状态，必须再次审核。归档保留历史和加密凭据。

不需要为单个智能体修改环境变量、手工创建 Secret 引用、计算摘要或调用 API。部署前仍需让 Moss 连接到可写 Nexus Secret；页面会提示凭据服务不可用。

## 用户操作

选择智能体，输入合成测试问题并发送。页面每 750ms 读取持久化事件及 Task 投影，显示增量回答。继续对话复用 Dify 会话；刷新后恢复历史。提交响应不明时使用同一幂等 key 核对；unknown 会话保持只读。取消、固定远端版本、恢复远端执行尚不支持，返回的 actions 不执行本机操作。

## 实现与验证

- Desktop：IPC `external-providers.*` → `mossExternalProviders` → 当前账号 Moss 地址/令牌（Electron net.fetch）；账号切换拒绝迟到响应。
- WebUI：相同 IPC 契约 → mossAdapter → 管理/用户接口白名单代理 → Session 的 Moss 上下文。权限由 Moss 独立校验，隐藏按钮不作为鉴权手段。
- `@sudowork/moss-client/external-providers` 使用运行时 schema 验证结果；仅接入、测试新 key 和换密钥操作携带短暂的明文输入，存储在服务端 Nexus Secret，用户执行不持有 Dify key。
- 契约语义源在 Moss，经 sudostack experimental 派生。`bun run check:external-contract` 校验来源与 digest；稳定 contracts exports 未改变。

详细接口、基线、真实 Dify 验证证据和基础设施边界见配套 Moss 分支 `docs/external-provider-pilot.md`。管理界面测试、真实 WebUI 代理/共用页面验收与桌面桥接测试分别记录，不将浏览器验收冒充完整 Electron 客户端验收。
