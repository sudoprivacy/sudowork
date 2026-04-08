# 任务列表

**分类:** 任务管理
**路径:** `GET /api.php/v1/executions/{executionID}/tasks`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| executionID | int | 是 | 迭代ID |
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |
| status | string | 否 | 任务状态 |

### 请求示例

```json
GET /api.php/v1/executions/1/tasks?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| tasks | array | 任务列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 32,
  "limit": 20,
  "tasks": [
    {
      "id": 1,
      "execution": 1,
      "name": "用户登录模块开发",
      "type": "devel",
      "pri": 1,
      "estimate": 16,
      "consumed": 12,
      "left": 4,
      "deadline": "2024-01-10",
      "status": "doing",
      "assignedTo": "1"
    }
  ]
}
```

### 备注

获取指定迭代下的任务列表。
