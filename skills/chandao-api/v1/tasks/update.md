# 更新任务

**分类:** 任务管理
**路径:** `PUT /api.php/v1/tasks/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 任务ID |
| name | string | 否 | 任务名称 |
| type | string | 否 | 任务类型 |
| assignedTo | string | 否 | 分配人 |
| estimate | int | 否 | 工作量估算 |
| pri | int | 否 | 优先级 |
| deadline | string | 否 | 截止日期 |
| desc | string | 否 | 任务描述 |
| status | string | 否 | 任务状态 |

### 请求示例

```json
PUT /api.php/v1/tasks/1
Content-Type: application/json

{
  "name": "用户登录模块开发（已调整）",
  "estimate": 18,
  "pri": 2
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 任务ID |
| name | string | 任务名称 |
| estimate | int | 工作量估算 |

### 响应示例

```json
{
  "task": {
    "id": 1,
    "name": "用户登录模块开发（已调整）",
    "estimate": 18
  }
}
```

### 备注

更新任务信息。只需提供需要修改的字段。
