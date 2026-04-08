# 迭代列表

**分类:** 迭代管理
**路径:** `GET /api.php/v1/projects/{projectID}/executions`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| projectID | int | 是 | 项目ID |
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |

### 请求示例

```json
GET /api.php/v1/projects/1/executions?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| executions | array | 迭代列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 4,
  "limit": 20,
  "executions": [
    {
      "id": 1,
      "name": "Sprint 1",
      "code": "sprint-1",
      "begin": "2024-01-01",
      "end": "2024-01-14",
      "status": "closed",
      "tasks": 32,
      "progress": 100
    }
  ]
}
```

### 备注

获取指定项目下的迭代列表。迭代即项目管理中的Sprint。
