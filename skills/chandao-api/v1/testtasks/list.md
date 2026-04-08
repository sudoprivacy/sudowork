# 测试任务列表

**分类:** 测试管理
**路径:** `GET /api.php/v1/testtasks`，`GET /api.php/v1/projects/{projectID}/testtasks`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| productID/projectID | int | 是 | 产品或项目ID |
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |

### 请求示例

```json
GET /api.php/v1/products/1/testtasks?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| testtasks | array | 测试任务列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 8,
  "limit": 20,
  "testtasks": [
    {
      "id": 1,
      "name": "Sprint 1测试",
      "product": 1,
      "begin": "2024-01-01",
      "end": "2024-01-14",
      "status": "doing",
      "testcases": 25
    }
  ]
}
```

### 备注

获取测试任务列表。支持两种路径：
- `GET /api.php/v1/testtasks` — 全部测试单
- `GET /api.php/v1/projects/{projectID}/testtasks` — 项目下的测试单

⚠️ `GET /products/{productID}/testtasks` 在云禅道开源版 18.12 中返回 404，请使用上述路径。
