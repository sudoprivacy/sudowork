# 园区应用

`apps/park` 一次构建公开咨询页和内部 14 页，同一服务提供 `/consult`、`/public/*` 与 `/park/*`。公开咨询的 `/public/*` 代理到 Moss。园区端在 Park 服务内管理独立登录会话，并通过 `/park/api/v1/parks/*` 调用 Moss 园区接口；不需要启动 WebUI。

构建与运行：

```powershell
bun run --filter @sudowork/park build
$env:MOSS_BASE_URL = 'http://127.0.0.1:3000'
$env:PARK_PUBLIC_ORIGIN = 'https://park.example.com'
$env:PARK_PUBLIC_PROXY_HMAC_KEY = '<与 Moss 相同的密钥>'
$env:PARK_SESSION_HMAC_KEY = '<64 位十六进制随机密钥>'
$env:PARK_TOKEN_AES_KEY = '<另一把 64 位十六进制随机密钥>'
$env:PARK_SESSION_DB = 'C:\park-data\sessions.sqlite'
bun run --filter @sudowork/park start
```

将外部 `/consult`、`/public/*` 与 `/park/*` 转发到同一个园区服务。`PARK_PUBLIC_ORIGIN` 必须是浏览器访问园区端时的完整源（协议、主机及非默认端口）；服务用它检查写请求的 Origin。园区会话存于 Park 自有 SQLite 数据库，Moss token 加密保存，登录 Cookie 为 host-only、`Path=/park`；公开咨询 Cookie 限定在 `/public`。两把密钥应分别生成并持久保管，重启时保持不变。若服务前面有反向代理，按 Moss 园区部署约定配置 `PARK_TRUSTED_FRONT_PROXY_IPS`。

本地开发时可运行 `bun run --filter @sudowork/park dev:server`（`PORT=4177`，`PARK_PUBLIC_ORIGIN=http://127.0.0.1:4176`）和 `bun run --filter @sudowork/park dev`；Vite 将 `/park/api/*` 转发到 Park 服务。Park 和 WebUI 的启动互不依赖。

本地跨应用浏览器测试：

```powershell
cd apps/park
bun run test:unit
bun run test:e2e
```

单元测试检查园区会话和代理边界。E2E 命令构建园区应用，并仅启动 Moss 测试实例与 Park 服务。

## 隔离验收实例

真实 Moss + Park 验收使用独立 SQLite 数据目录，不能指向生产库。Moss 需以 `PARK_ORG_ID`、`PARK_PUBLIC_URL`、`PARK_PUBLIC_PROXY_HMAC_KEY`、`PARK_SMS_HMAC_KEY` 和 `PARK_CAPTCHA_HMAC_KEY` 启动；Park 需以相同代理密钥、Moss 地址、独立会话库、`PARK_SESSION_HMAC_KEY` 和 `PARK_TOKEN_AES_KEY` 启动。两服务各自启动，WebUI 无需运行。短信交付选 `log`，测试从 Moss 日志读取验证码。

在隔离库中预置园区组织、三类园区账号及密码、一个非园区管理账号、公开配置、4–8 个快捷问题，以及三组政策：已发布且生效、已发布但过期、未发布。发布 Assistant 并连接确定性 OpenAI 兼容模型替身，同时记录模型调用。`acceptance.json` 需包含 `orgId`、`userPassword`、`parkrecruiter`（招商账号的 Moss 用户 ID）、`admin.username` 和 `admin.password`；同目录需有 `moss.db`、`moss-console.log` 和 `model-stub-calls.jsonl`。账号凭据与密钥只保存在隔离目录，勿提交到仓库。

```powershell
cd apps/park
$env:PARK_ACCEPTANCE_FILE = 'C:\path\to\isolated-acceptance\acceptance.json'
$env:PARK_ACCEPTANCE_URL = 'http://127.0.0.1:4176'
$env:MOSS_ACCEPTANCE_URL = 'http://127.0.0.1:4174'
bun run test:acceptance
```

真实服务测试覆盖政策引用、模型调用、会话幂等、线索和联系方式落库、短信日志发码及核销、三角色权限、脱敏、限流与拒绝记录、审计、合规指标和 CAPTCHA 挑战。测试会临时修改限流配置并在结束时恢复，故验收期间不要并行修改该配置。园区 E2E 可用 `PARK_E2E_MOSS_PORT` 与 `PARK_E2E_PORT` 指定另一组端口，与验收服务并行运行。

模型替身只验证调用链与确定性依据，日志短信只验证发码流程；真实模型回答质量、腾讯云实际送达和实体盒子的升级、备份恢复及回滚，仍需对应的外部服务或盒子环境验收。
