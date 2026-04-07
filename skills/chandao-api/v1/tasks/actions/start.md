# 开始任务

**分类:** 任务管理
**路径:** `POST /api.php/v1/tasks/{id}/start`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 任务ID |

### 请求示例

```json
POST /api.php/v1/tasks/1/start
Content-Type: application/json

{}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 任务ID |
| status | string | 任务状态 |
| realStarted | string | 实际开始时间 |

### 响应示例

```json
{
  "id": 1,
  "status": "doing",
  "realStarted": "2024-01-02 10:30:00"
}
```

### 备注

将任务状态变更为进行中。系统自动记录实际开始时间。
