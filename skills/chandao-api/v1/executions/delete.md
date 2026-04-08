# 删除迭代

**分类:** 迭代管理
**路径:** `DELETE /api.php/v1/executions/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 迭代ID |

### 请求示例

```json
DELETE /api.php/v1/executions/1
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
  "message": "迭代已删除"
}
```

### 备注

删除指定迭代。删除前会检查该迭代是否有关联的任务。
