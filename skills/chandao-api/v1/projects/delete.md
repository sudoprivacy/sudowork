# 删除项目

**分类:** 项目管理
**路径:** `DELETE /api.php/v1/projects/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 项目ID |

### 请求示例

```json
DELETE /api.php/v1/projects/1
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
  "message": "项目已删除"
}
```

### 备注

删除指定项目。删除前会检查该项目是否有关联的迭代或任务。
