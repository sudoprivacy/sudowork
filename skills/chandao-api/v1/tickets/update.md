# 更新工作单

**分类:** 工作单管理
**路径:** `PUT /api.php/v1/tickets/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 工作单ID |
| title | string | 否 | 工作单标题 |
| desc | string | 否 | 工作单描述 |
| type | string | 否 | 工作单类型 |
| assignedTo | string | 否 | 分配人 |
| pri | int | 否 | 优先级 |
| status | string | 否 | 工作单状态 |

### 请求示例

```json
PUT /api.php/v1/tickets/1
Content-Type: application/json

{
  "title": "服务器维护（已完成）",
  "status": "closed"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 工作单ID |
| title | string | 工作单标题 |
| status | string | 工作单状态 |

### 响应示例

```json
{
  "ticket": {
    "id": 1,
    "title": "服务器维护（已完成）",
    "status": "closed"
  }
}
```

### 备注

更新工作单信息。只需提供需要修改的字段。

⚠️ **工单模块在云禅道开源版中返回 403，仅限企业版/旗舰版。**
