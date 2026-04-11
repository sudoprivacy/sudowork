# 删除故事

**分类:** 故事管理
**路径:** `DELETE /api.php/v1/stories/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 故事ID |

### 请求示例

```json
DELETE /api.php/v1/stories/1
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
  "message": "故事已删除"
}
```

### 备注

删除指定故事。删除前会检查该故事是否有关联的任务或bug。
