# 获取当前用户信息

**分类:** 用户管理
**路径:** `GET /api.php/v1/user`
**Content-Type:** `application/json`

### 请求参数

无

### 请求示例

```json
GET /api.php/v1/user
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 用户ID |
| account | string | 账户名 |
| realname | string | 真实姓名 |
| role | string | 角色 |
| email | string | 邮箱 |
| dept | int | 所属部门ID |
| gender | string | 性别(m/f) |
| join | string | 加入日期 |
| visits | int | 访问次数 |
| last | string | 最后访问时间 |
| admin | boolean | 是否管理员 |
| visions | string | 权限 |
| view | string | 显示视图 |

### 响应示例

```json
{
  "profile": {
    "id": 1,
    "account": "admin",
    "realname": "张三",
    "role": "pm",
    "email": "admin@example.com",
    "dept": 1,
    "gender": "m",
    "join": "2024-01-01",
    "visits": 156,
    "last": "2024-04-07 10:30:00",
    "admin": true,
    "visions": "view",
    "view": "all"
  }
}
```

### 备注

获取当前登录用户的个人资料信息。
