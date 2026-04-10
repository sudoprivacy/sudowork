# 发布版本列表

**分类:** 版本管理
**路径:** `GET /api.php/v1/products/{productID}/releases`，`GET /api.php/v1/projects/{projectID}/releases`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| productID/projectID | int | 是 | 产品或项目ID |
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |

### 请求示例

```json
GET /api.php/v1/products/1/releases?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| releases | array | 发布版本列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 5,
  "limit": 20,
  "releases": [
    {
      "id": 1,
      "name": "v1.0.0",
      "product": 1,
      "date": "2024-01-10",
      "status": "released"
    }
  ]
}
```

### 备注

获取指定产品或项目的发布版本列表。
