# 版本构建列表

**分类:** 版本管理
**路径:** `GET /api.php/v1/projects/{projectID}/builds`，`GET /api.php/v1/executions/{executionID}/builds`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| projectID/executionID | int | 是 | 项目或迭代ID |
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |

### 请求示例

```json
GET /api.php/v1/projects/1/builds?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| builds | array | 版本构建列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 12,
  "limit": 20,
  "builds": [
    {
      "id": 1,
      "name": "v1.0.0",
      "product": 1,
      "date": "2024-01-10",
      "status": "success",
      "desc": "第一个正式版本发布"
    }
  ]
}
```

### 备注

获取指定项目或迭代下的版本构建列表。
