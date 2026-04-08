# 创建用户

**分类:** 用户管理
**路径:** `POST /api.php/v1/users`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| account | string | 是 | 账户名，唯一 |
| password | string | 是 | 密码 |
| realname | string | 是 | 真实姓名 |
| role | string | 否 | 角色，如pm/dev/qa/pd |
| email | string | 否 | 邮箱 |
| dept | int | 否 | 所属部门ID |
| gender | string | 否 | 性别(m/f) |

### 请求示例

```json
POST /api.php/v1/users
Content-Type: application/json

{
  "account": "newuser",
  "password": "password123",
  "realname": "王五",
  "role": "dev",
  "email": "newuser@example.com",
  "dept": 2,
  "gender": "m"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新创建用户的ID |
| account | string | 账户名 |
| realname | string | 真实姓名 |
| role | string | 角色 |
| email | string | 邮箱 |
| dept | int | 部门ID |

### 响应示例

```json
{
  "user": {
    "id": 3,
    "account": "newuser",
    "realname": "王五",
    "role": "dev",
    "email": "newuser@example.com",
    "dept": 2
  }
}
```

### 备注

创建新用户。account必须唯一。密码会自动加密存储。
