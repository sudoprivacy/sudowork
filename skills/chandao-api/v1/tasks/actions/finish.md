# 完成任务

**分类:** 任务管理
**路径:** `POST /api.php/v1/tasks/{id}/finish`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 任务ID（路径参数） |
| consumed | float | 是 | 总计消耗工时（必须 > 0） |
| currentConsumed | float | 是 | 本次消耗工时 |
| left | float | 否 | 剩余工时，通常为0 |
| realStarted | date | 是 | 实际开始日期 YYYY-MM-DD |
| finishedDate | date | 是 | 实际完成日期 YYYY-MM-DD |

### 请求示例

```json
POST /api.php/v1/tasks/1/finish
Content-Type: application/json

{
  "consumed": 16,
  "currentConsumed": 8,
  "left": 0,
  "realStarted": "2026-04-08",
  "finishedDate": "2026-04-14"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 任务ID |
| status | string | 任务状态 |
| consumed | int | 已消耗工作量 |
| left | int | 剩余工作量 |

### 响应示例

```json
{
  "id": 1,
  "status": "done",
  "consumed": 16,
  "left": 0
}
```

### 备注

完成任务并记录最终的工作量消耗。通常left应设置为0。
