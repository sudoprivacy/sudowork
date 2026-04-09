# 删除版本构建

**分类:** 版本管理
**路径:** `DELETE /api.php/v1/builds/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 版本构建ID |

### 请求示例

```json
DELETE /api.php/v1/builds/1
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
  "message": "版本构建已删除"
}
```

### 备注

删除指定版本构建。
