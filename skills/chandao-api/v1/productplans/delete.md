# 删除产品计划

**分类:** 产品规划
**路径:** `DELETE /api.php/v1/productplans/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 产品计划ID |

### 请求示例

```json
DELETE /api.php/v1/productplans/1
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
  "message": "计划已删除"
}
```

### 备注

删除指定产品计划。
