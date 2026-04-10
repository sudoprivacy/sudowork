# 更新用户

**分类:** 用户管理
**路径:** `PUT /api.php/v1/users/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 用户ID |
| realname | string | 否 | 真实姓名 |
| role | string | 否 | 角色 |
| email | string | 否 | 邮箱 |
| dept | int | 否 | 所属部门ID |
| gender | string | 否 | 性别(m/f) |
| password | string | 否 | 新密码（仅在需要修改时提供） |

### 请求示例

```json
PUT /api.php/v1/users/3
Content-Type: application/json

{
  "realname": "王五（已更新）",
  "email": "newuser2@example.com",
  "role": "qa"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 用户ID |
| account | string | 账户名 |
| realname | string | 真实姓名 |
| role | string | 角色 |
| email | string | 邮箱 |

### 响应示例

```json
{
  "user": {
    "id": 3,
    "account": "newuser",
    "realname": "王五（已更新）",
    "role": "qa",
    "email": "newuser2@example.com"
  }
}
```

### 备注

更新用户信息。只需提供需要修改的字段。
