# 重启任务

**分类:** 任务管理
**路径:** `POST /api.php/v1/tasks/{id}/restart`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 任务ID（路径参数） |
| consumed | float | 是 | 总计消耗工时 |
| left | float | 是 | 预计剩余工时 |

### 请求示例

```json
POST /api.php/v1/tasks/1/restart
Content-Type: application/json

{
  "consumed": 2,
  "left": 6
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 任务ID |
| status | string | 任务状态 |
| message | string | 提示信息 |

### 响应示例

```json
{
  "id": 1,
  "status": "doing",
  "message": "任务已重启"
}
```

### 备注

将暂停的任务重新开始。状态变更为进行中。
