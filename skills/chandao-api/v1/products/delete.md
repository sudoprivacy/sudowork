# 删除产品

**分类:** 产品管理
**路径:** `DELETE /api.php/v1/products/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 产品ID |

### 请求示例

```json
DELETE /api.php/v1/products/2
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
  "message": "产品已删除"
}
```

### 备注

删除指定产品。删除前会检查是否有关联的项目或故事。
