# 创建任务

**分类:** 任务管理
**路径:** `POST /api.php/v1/executions/{executionID}/tasks`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| executionID | int | 是 | 迭代ID |
| name | string | 是 | 任务名称 |
| type | string | 否 | 任务类型(devel/test/design/discuss/ui/affair/misc) |
| assignedTo | string | 否 | 分配人ID |
| estimate | int | 否 | 工作量估算 |
| pri | int | 否 | 优先级(1-4) |
| estStarted | string | 是 | 计划开始日期(YYYY-MM-DD) |
| deadline | string | 否 | 截止日期(YYYY-MM-DD) |
| story | int | 否 | 关联故事ID |
| desc | string | 否 | 任务描述(HTML) |

### 请求示例

```json
POST /api.php/v1/executions/1/tasks
Content-Type: application/json

{
  "name": "用户登录模块开发",
  "type": "devel",
  "assignedTo": "1",
  "estimate": 16,
  "pri": 1,
  "estStarted": "2024-01-01",
  "deadline": "2024-01-10",
  "story": 1,
  "desc": "<p>开发用户登录模块</p>"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新任务ID |
| name | string | 任务名称 |
| type | string | 任务类型 |
| status | string | 任务状态 |

### 响应示例

```json
{
  "task": {
    "id": 2,
    "name": "用户登录模块开发",
    "type": "devel",
    "status": "wait"
  }
}
```

### 备注

在指定迭代下创建新任务。name和estStarted为必填项。
