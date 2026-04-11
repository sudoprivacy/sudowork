# 产品列表

**分类:** 产品管理
**路径:** `GET /api.php/v1/products`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |
| status | string | 否 | 状态过滤 |

### 请求示例

```json
GET /api.php/v1/products?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| products | array | 产品列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 5,
  "limit": 20,
  "products": [
    {
      "id": 1,
      "name": "ZenTao项目管理",
      "code": "zentao",
      "type": "normal",
      "status": "normal",
      "PO": "1",
      "QD": "2024-01-01",
      "RD": "2024-06-01",
      "desc": "功能齐全的项目管理系统",
      "acl": "open",
      "totalStories": 120,
      "activeStories": 45,
      "unresolvedBugs": 8,
      "totalBugs": 156,
      "plans": 3,
      "releases": 2
    }
  ]
}
```

### 备注

返回分页产品列表。包含产品的统计信息如故事数、bug数等。
