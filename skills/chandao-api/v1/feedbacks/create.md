# 创建反馈

**分类:** 反馈管理
**路径:** `POST /api.php/v1/feedbacks`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| title | string | 是 | 反馈标题 |
| desc | string | 否 | 反馈描述 |
| type | string | 否 | 反馈类型(suggest/bug/praise/question) |
| assignedTo | string | 否 | 分配人ID |

### 请求示例

```json
POST /api.php/v1/feedbacks
Content-Type: application/json

{
  "title": "新功能建议",
  "desc": "建议添加暗色主题",
  "type": "suggest",
  "assignedTo": "1"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新反馈ID |
| title | string | 反馈标题 |
| status | string | 反馈状态 |

### 响应示例

```json
{
  "feedback": {
    "id": 2,
    "title": "新功能建议",
    "status": "open"
  }
}
```

### 备注

创建新用户反馈。title为必填项。
