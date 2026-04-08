# 更新反馈

**分类:** 反馈管理
**路径:** `PUT /api.php/v1/feedbacks/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 反馈ID |
| title | string | 否 | 反馈标题 |
| desc | string | 否 | 反馈描述 |
| type | string | 否 | 反馈类型 |
| assignedTo | string | 否 | 分配人 |
| status | string | 否 | 反馈状态 |

### 请求示例

```json
PUT /api.php/v1/feedbacks/1
Content-Type: application/json

{
  "title": "登录页面优化建议（已评审）",
  "status": "processing"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 反馈ID |
| title | string | 反馈标题 |
| status | string | 反馈状态 |

### 响应示例

```json
{
  "feedback": {
    "id": 1,
    "title": "登录页面优化建议（已评审）",
    "status": "processing"
  }
}
```

### 备注

更新反馈信息。只需提供需要修改的字段。
