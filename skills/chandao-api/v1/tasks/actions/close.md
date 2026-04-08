# 关闭任务

**分类:** 任务管理
**路径:** `POST /api.php/v1/tasks/{id}/close`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 任务ID |

### 请求示例

```json
POST /api.php/v1/tasks/1/close
Content-Type: application/json

{}
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
  "status": "closed",
  "message": "任务已关闭"
}
```

### 备注

关闭任务。关闭后的任务将从活跃列表中移除。
