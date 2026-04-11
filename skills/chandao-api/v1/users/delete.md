# 删除用户

**分类:** 用户管理
**路径:** `DELETE /api.php/v1/users/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 用户ID |

### 请求示例

```json
DELETE /api.php/v1/users/3
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| status | string | 状态，success表示删除成功 |
| message | string | 提示信息 |

### 响应示例

```json
{
  "status": "success",
  "message": "用户已删除"
}
```

### 备注

删除指定用户。删除后无法恢复，请谨慎操作。
