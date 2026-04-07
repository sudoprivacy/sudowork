# 删除任务

**分类:** 任务管理
**路径:** `DELETE /api.php/v1/tasks/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 任务ID |

### 请求示例

```json
DELETE /api.php/v1/tasks/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| status | string | 状态 |
| message | string | 提示信息 |

### 响应示例

```json
{
  "status": "success",
  "message": "任务已删除"
}
```

### 备注

删除指定任务。删除前会检查任务是否有关联的工作日志。
