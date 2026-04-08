# 工作单详情

**分类:** 工作单管理
**路径:** `GET /api.php/v1/tickets/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 工作单ID |

### 请求示例

```json
GET /api.php/v1/tickets/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 工作单ID |
| title | string | 工作单标题 |
| desc | string | 工作单描述 |
| type | string | 工作单类型 |
| status | string | 工作单状态 |
| pri | int | 优先级 |
| assignedTo | string | 分配人 |
| createdBy | string | 创建人 |
| createdDate | string | 创建日期 |

### 响应示例

```json
{
  "ticket": {
    "id": 1,
    "title": "服务器维护",
    "desc": "进行服务器定期维护和更新",
    "type": "task",
    "status": "open",
    "pri": 2,
    "assignedTo": "1",
    "createdBy": "2",
    "createdDate": "2024-04-01"
  }
}
```

### 备注

获取指定工作单的详细信息。

⚠️ **工单模块在云禅道开源版中返回 403，仅限企业版/旗舰版。**
