# 中国商飞 CAS 认证接入方案

Date: 2026-07-01
Status: design reviewed; client implementation in progress
Source: `~/Downloads/统一认证接入开发文档 Powered by MM-Wiki.pdf`

## 1. 目标

在 sudowork 登录页增加“三方认证登录”方式，首个 provider 为“中国商飞 CAS”。用户点击后跳转到客户 CAS 登录页；CAS 登录成功后带 `ticket` 跳回 sudowork app；sudowork-server 验证 `ticket`、完成用户查找/自动创建/额度初始化后返回标准登录 token；客户端复用现有登录成功逻辑进入 `/guid`。

## 2. CAS 文档要点

商飞 CAS API 前缀：`http://cas.cvtol.com/`。

- 登录跳转：`GET /cas/login/?service={SERVICE}`
- 登录成功回跳：`{SERVICE}?ticket=ST-...`
- 验票接口：`GET /cas/p3/serviceValidate?service={SERVICE}&ticket={TICKET}`
- 验票返回：XML，成功时包含 `cas:user` 和 `cas:attributes`，其中有 `username`、`first_name`、`last_name`、`email`、`is_active` 等字段
- 登出跳转：`GET /cas/logout?service={SERVICE}`

关键约束：`serviceValidate` 的 `service` 必须与登录跳转时传给 CAS 的 `service` 完全一致。

## 3. 服务端配置模型

建议 sudowork-server 的系统配置页面增加登录方式：

- `login_method = 0`：手机验证码
- `login_method = 1`：账号密码
- `login_method = 2`：三方认证登录

公共系统配置 `GET /api/v1/system-config` 新增字段：

```json
{
  "login_method": 2,
  "third_party_auth": {
    "enabled": true,
    "default_provider": "comac_cas",
    "providers": [
      {
        "id": "comac_cas",
        "name": "中国商飞",
        "type": "cas",
        "cas_url": "http://cas.cvtol.com/",
        "login_path": "/cas/login/",
        "validate_path": "/cas/p3/serviceValidate",
        "logout_path": "/cas/logout",
        "service_param": "service"
      }
    ]
  }
}
```

客户端会解析该配置；如果 `login_method=2` 但未下发 provider，会使用商飞 CAS 默认 provider 兜底。

## 4. 登录流程

1. 客户端启动登录页，读取 `GET /api/v1/system-config`。
2. 当 `login_method=2` 时，登录页显示“三方认证登录”和 provider 选择。
3. 用户点击登录，客户端生成 `state`，构造：
   - `service = sudowork://cas-callback?provider=comac_cas&state={state}`
   - CAS 登录 URL：`http://cas.cvtol.com/cas/login/?service={encodeURIComponent(service)}`
4. 客户端用系统浏览器打开 CAS 登录 URL。
5. CAS 登录成功后跳回 `sudowork://cas-callback?...&ticket=ST-...`。
6. 客户端校验 `state` 和 provider 后调用 sudowork-server：
   - `POST /api/v1/auth/third-party/cas/login`
   - body：`{ provider, ticket, service, state }`
7. sudowork-server 调商飞 `serviceValidate` 验票，解析 XML 用户信息。
8. sudowork-server 在 provider 对应租户内查找用户；不存在则自动创建普通用户，并补齐邀请码、积分额度、默认无限额度等现有注册副作用。
9. sudowork-server 返回与现有 `/api/v1/auth/login` 一致的 token payload。
10. 客户端复用 `handleLoginSuccess`，同步 sudocode/sudoclaw 配置并跳转 `/guid`。

## 5. 后端职责

这些职责必须在 sudowork-server 中完成，客户端不应承担：

- CAS `ticket` 验证和 XML 解析
- provider 到租户的绑定
- CAS 外部身份到本地用户的映射
- 用户不存在时的自动创建
- 邀请码流程补齐
- 积分/额度初始化，包括默认无限额度
- 账号状态检查、禁用用户拒绝登录
- token 签发和 refresh/logout 生命周期

建议新增表或配置项保存外部身份映射：

- `provider_id`
- `external_user_id`，优先使用 CAS `cas:user` 或 `username`
- `tenant_id`
- `local_user_id`
- CAS attributes 原始快照或安全子集

## 6. 安全设计

- 客户端生成并校验 `state`，防止错误回调串入当前登录会话。
- 客户端不记录 `ticket`，错误日志不得包含完整 ticket。
- 后端验票必须使用原始 `service` 字符串。
- `ticket` 一次性使用，验票失败直接拒绝登录。
- provider 配置必须由服务端控制，不允许用户在登录页手写 CAS URL。
- 自动创建用户必须绑定 provider 对应租户，不允许从客户端参数决定租户。

## 7. 客户端改动

- 扩展 `SystemConfig` 和 `useSystemLoginMethod`，支持 `login_method=2` 与 `third_party_auth`。
- 新增 CAS provider 配置解析工具，内置商飞默认 provider。
- 登录页新增 `ThirdPartyAuthPanel`。
- `AuthContext` 新增 `loginWithThirdPartyAuth`，调用 sudowork-server CAS 登录接口并复用现有登录成功逻辑。
- 复用现有 deep link 分发：新增处理 `sudowork://cas-callback`。

## 8. 自审结论

- 完整性：覆盖了 CAS 跳转、回调、验票、用户自动创建、token 返回、客户端收尾。
- 可扩展性：provider 使用数组配置，后续可增加其他客户 CAS/OIDC provider。
- 边界清晰：客户 CAS 密钥/验票/用户创建均在 sudowork-server，客户端只处理跳转和 token 落地。
- 风险点：当前仓库不包含 sudowork-server 代码，后端接口和系统配置页面必须在对应仓库实现后，客户端 CAS 登录才能端到端可用。
