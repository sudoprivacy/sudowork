# 故事列表

**分类:** 故事管理
**路径:** `GET /api.php/v1/products/{productID}/stories`，`GET /api.php/v1/projects/{projectID}/stories`，`GET /api.php/v1/executions/{executionID}/stories`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| productID/projectID/executionID | int | 是 | 容器ID |
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |
| status | string | 否 | 故事状态 |

### 请求示例

```json
GET /api.php/v1/products/1/stories?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| stories | array | 故事列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 15,
  "limit": 20,
  "stories": [
    {
      "id": 1,
      "title": "用户登录功能",
      "type": "story",
      "category": "feature",
      "pri": 1,
      "estimate": 8,
      "status": "active",
      "assignedTo": "1",
      "spec": "<p>实现用户登录功能</p>",
      "verify": "<p>验收标准</p>"
    }
  ]
}
```

### 备注

获取指定容器下的故事列表。可按照产品、项目或迭代来查询。
