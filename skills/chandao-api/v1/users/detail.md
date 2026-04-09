# 用户详情

**分类:** 用户管理
**路径:** `GET /api.php/v1/users/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 用户ID |

### 请求示例

```json
GET /api.php/v1/users/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 用户ID |
| dept | int | 所属部门ID |
| account | string | 账户名 |
| realname | string | 真实姓名 |
| role | string | 角色 |
| email | string | 邮箱 |
| gender | string | 性别(m/f) |
| join | string | 加入日期 |
| visits | int | 访问次数 |
| last | string | 最后访问时间 |
| admin | boolean | 是否管理员 |
| status | string | 用户状态 |

### 响应示例

```json
{
  "user": {
    "id": 1,
    "dept": 1,
    "account": "admin",
    "realname": "张三",
    "role": "pm",
    "email": "admin@example.com",
    "gender": "m",
    "join": "2024-01-01",
    "visits": 156,
    "last": "2024-04-07 10:30:00",
    "admin": true,
    "status": "active"
  }
}
```

### 备注

获取指定用户的详细信息。
