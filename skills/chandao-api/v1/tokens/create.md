# 获取 Token

**分类:** 认证
**路径:** `POST /api.php/v1/tokens`
**Content-Type:** `application/json`

### 请求参数

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| account | String | 是 | 登录账号 |
| password | String | 是 | 登录密码 |

### 请求示例

```json
{
  "account": "admin",
  "password": "your_password"
}
```

### 响应参数

| 参数名 | 类型 | 说明 |
| --- | --- | --- |
| token | String | API 凭证，后续请求需在 Header 中携带 `Token: <值>` |

### 响应示例

```json
{
  "token": "2ak4ee9gtpn0065pebanqilgu6"
}
```

### 备注

- Token 有效期 1440 秒（24 分钟），过期后需重新获取
- 所有后续请求需在 HTTP Header 中携带 `Token: <token值>`
