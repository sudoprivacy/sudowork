# 工作单列表

**分类:** 工作单管理
**路径:** `GET /api.php/v1/tickets`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |
| status | string | 否 | 工作单状态 |

### 请求示例

```json
GET /api.php/v1/tickets?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| tickets | array | 工作单列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 28,
  "limit": 20,
  "tickets": [
    {
      "id": 1,
      "title": "服务器维护",
      "type": "task",
      "status": "open",
      "pri": 2,
      "assignedTo": "1",
      "createdBy": "2"
    }
  ]
}
```

### 备注

获取工单列表。

⚠️ **工单（Ticket）模块在云禅道开源版 18.12 中返回 403 Access not allowed。** 此功能仅限企业版/旗舰版。
