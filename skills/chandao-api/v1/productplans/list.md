# 产品计划列表

**分类:** 产品规划
**路径:** `GET /api.php/v1/products/{productID}/plans`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| productID | int | 是 | 产品ID |
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |

### 请求示例

```json
GET /api.php/v1/products/1/plans?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| plans | array | 产品计划列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 6,
  "limit": 20,
  "plans": [
    {
      "id": 1,
      "title": "Q1产品规划",
      "begin": "2024-01-01",
      "end": "2024-03-31",
      "status": "active",
      "stories": 24,
      "bugs": 8
    }
  ]
}
```

### 备注

获取指定产品的计划列表。
