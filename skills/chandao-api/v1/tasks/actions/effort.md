# 记录工作日志

**分类:** 任务管理
**路径:** `POST /api.php/v1/tasks/{id}/effort`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 任务ID |
| consumed | int | 是 | 本次消耗工作量 |
| left | int | 是 | 剩余工作量 |
| date | string | 是 | 工作日期(YYYY-MM-DD) |

### 请求示例

```json
POST /api.php/v1/tasks/1/effort
Content-Type: application/json

{
  "consumed": 4,
  "left": 12,
  "date": "2024-01-02"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 任务ID |
| consumed | int | 累计已消耗工作量 |
| left | int | 剩余工作量 |
| message | string | 提示信息 |

### 响应示例

```json
{
  "id": 1,
  "consumed": 4,
  "left": 12,
  "message": "工作日志已记录"
}
```

### 备注

记录任务的工作时间日志。可多次调用来累计工作量。

⚠️ **此接口在云禅道开源版 18.12 中返回 404 Not Found。** 已测试 `/effort` 和 `/efforts` 两种路径，均不可用。可能仅限企业版/旗舰版。替代方案：通过 `POST /api.php/v1/tasks/{id}/finish` 在完成任务时一并记录工时。
