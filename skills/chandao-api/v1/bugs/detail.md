# Bug详情

**分类:** Bug管理
**路径:** `GET /api.php/v1/bugs/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | BugID |

### 请求示例

```json
GET /api.php/v1/bugs/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | BugID |
| product | int | 产品ID |
| title | string | Bug标题 |
| severity | int | 严重程度(1-4) |
| pri | int | 优先级(1-4) |
| type | string | Bug类型 |
| status | string | Bug状态 |
| steps | string | 重现步骤 |
| confirmed | boolean | 是否已确认 |
| openedBy | string | 报告人 |
| openedBuild | string | 报告版本 |
| assignedTo | string | 分配人 |
| resolvedBy | string | 解决人 |
| resolution | string | 解决方案 |
| closedBy | string | 关闭人 |

### 响应示例

```json
{
  "bug": {
    "id": 1,
    "product": 1,
    "title": "登录页面样式错位",
    "severity": 2,
    "pri": 2,
    "type": "codeerror",
    "status": "active",
    "steps": "<p>1. 打开登录页面\n2. 刷新页面\n3. 观察样式</p>",
    "confirmed": true,
    "openedBy": "1",
    "openedBuild": "trunk",
    "assignedTo": "2",
    "resolvedBy": null,
    "resolution": null,
    "closedBy": null
  }
}
```

### 备注

获取指定Bug的详细信息。
