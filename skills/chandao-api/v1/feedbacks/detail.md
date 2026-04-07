# 反馈详情

**分类:** 反馈管理
**路径:** `GET /api.php/v1/feedbacks/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 反馈ID |

### 请求示例

```json
GET /api.php/v1/feedbacks/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 反馈ID |
| title | string | 反馈标题 |
| desc | string | 反馈描述 |
| type | string | 反馈类型 |
| status | string | 反馈状态 |
| assignedTo | string | 分配人 |
| createdBy | string | 提交人 |
| createdDate | string | 提交日期 |

### 响应示例

```json
{
  "feedback": {
    "id": 1,
    "title": "登录页面优化建议",
    "desc": "建议优化登录页面的UI设计",
    "type": "suggest",
    "status": "open",
    "assignedTo": "1",
    "createdBy": "4",
    "createdDate": "2024-04-01"
  }
}
```

### 备注

获取指定反馈的详细信息。
