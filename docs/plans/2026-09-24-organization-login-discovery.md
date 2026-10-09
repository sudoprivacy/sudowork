# 组织登录方式发现配套说明

基线：origin/dev 8042fca9；分支：codex/platform-config-login-isolation。

配合 Moss 同名分支使用。登录页增加企业码，获取 `/api/v1/system-config?organization_code=...` 的登录方式；空企业码表示部署默认入口。服务器地址和企业码共同作为缓存键，过期为 30 秒；未成功查询不缓存，旧请求不会覆盖新选择。

Web bootstrap 转发保留企业码。组织登录发现不会覆盖进程全局的客户端运行配置。客户端展示仅用于选择入口，真实组织和允许的认证方式仍由 Moss 按账号校验。

恢复已有 CAS 登录面板与 Moss 原生 CAS 接口对接；新服务端不依赖旧兼容 Host 开关。手机注册入口仅在当前组织允许短信方式时显示。

验证：renderer TypeScript 检查；systemLoginMethod 的 3 项能力映射测试及 3 项组织/服务器缓存、响应竞争和失败重试测试通过。未发布客户端，也没有修改生产账号或配置。
