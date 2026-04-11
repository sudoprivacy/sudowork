# 删除Bug

**分类:** Bug管理
**路径:** `DELETE /api.php/v1/bugs/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | BugID |

### 请求示例

```json
DELETE /api.php/v1/bugs/1
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
  "message": "Bug已删除"
}
```

### 备注

删除指定Bug。删除前会检查Bug是否有关联的评论。
