# 用户列表

**分类:** 用户管理
**路径:** `GET /api.php/v1/users`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |

### 请求示例

```json
GET /api.php/v1/users?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| users | array | 用户列表数组 |

### 响应示例

```json
{
  "page": 1,
  "total": 42,
  "limit": 20,
  "users": [
    {
      "id": 1,
      "dept": 1,
      "account": "admin",
      "realname": "张三",
      "role": "pm",
      "email": "admin@example.com",
      "group": "manager"
    },
    {
      "id": 2,
      "dept": 2,
      "account": "dev001",
      "realname": "李四",
      "role": "dev",
      "email": "dev001@example.com",
      "group": "developer"
    }
  ]
}
```

### 备注

返回分页用户列表。支持按页码和每页数量进行分页查询。
