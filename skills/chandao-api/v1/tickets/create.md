# 创建工作单

**分类:** 工作单管理
**路径:** `POST /api.php/v1/tickets`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| title | string | 是 | 工作单标题 |
| desc | string | 否 | 工作单描述 |
| type | string | 否 | 工作单类型(task/issue/request) |
| assignedTo | string | 否 | 分配人ID |
| pri | int | 否 | 优先级(1-4) |

### 请求示例

```json
POST /api.php/v1/tickets
Content-Type: application/json

{
  "title": "数据库备份",
  "desc": "进行日常数据库备份",
  "type": "task",
  "assignedTo": "1",
  "pri": 3
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新工作单ID |
| title | string | 工作单标题 |
| status | string | 工作单状态 |

### 响应示例

```json
{
  "ticket": {
    "id": 2,
    "title": "数据库备份",
    "status": "open"
  }
}
```

### 备注

创建新工作单。title为必填项。

⚠️ **工单模块在云禅道开源版中返回 403，仅限企业版/旗舰版。**
