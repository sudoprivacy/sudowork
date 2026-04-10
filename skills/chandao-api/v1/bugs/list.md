# Bug列表

**分类:** Bug管理
**路径:** `GET /api.php/v1/products/{productID}/bugs`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| productID | int | 是 | 产品ID |
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |
| status | string | 否 | Bug状态 |

### 请求示例

```json
GET /api.php/v1/products/1/bugs?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| bugs | array | Bug列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 42,
  "limit": 20,
  "bugs": [
    {
      "id": 1,
      "product": 1,
      "title": "登录页面样式错位",
      "severity": 2,
      "pri": 2,
      "type": "codeerror",
      "status": "active",
      "confirmed": true,
      "openedBy": "1",
      "assignedTo": "2"
    }
  ]
}
```

### 备注

获取指定产品下的Bug列表。
