# 删除工作单

**分类:** 工作单管理
**路径:** `DELETE /api.php/v1/tickets/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 工作单ID |

### 请求示例

```json
DELETE /api.php/v1/tickets/1
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
  "message": "工作单已删除"
}
```

### 备注

删除指定工作单。

⚠️ **工单模块在云禅道开源版中返回 403，仅限企业版/旗舰版。**
