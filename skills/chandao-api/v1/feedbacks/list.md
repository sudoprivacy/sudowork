# 反馈列表

**分类:** 反馈管理
**路径:** `GET /api.php/v1/feedbacks`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |
| status | string | 否 | 反馈状态 |

### 请求示例

```json
GET /api.php/v1/feedbacks?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| feedbacks | array | 反馈列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 15,
  "limit": 20,
  "feedbacks": [
    {
      "id": 1,
      "title": "登录页面优化建议",
      "type": "suggest",
      "status": "open",
      "assignedTo": "1",
      "createdBy": "4"
    }
  ]
}
```

### 备注

获取用户反馈列表。
