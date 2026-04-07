# 故事详情

**分类:** 故事管理
**路径:** `GET /api.php/v1/stories/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 故事ID |

### 请求示例

```json
GET /api.php/v1/stories/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 故事ID |
| title | string | 故事标题 |
| type | string | 类型(story/requirement) |
| category | string | 分类 |
| pri | int | 优先级(1-4) |
| estimate | int | 工作量估算 |
| status | string | 状态 |
| assignedTo | string | 分配人 |
| spec | string | 规格说明(HTML) |
| verify | string | 验收标准(HTML) |

### 响应示例

```json
{
  "story": {
    "id": 1,
    "title": "用户登录功能",
    "type": "story",
    "category": "feature",
    "pri": 1,
    "estimate": 8,
    "status": "active",
    "assignedTo": "1",
    "spec": "<p>实现用户登录功能</p>",
    "verify": "<p>验收标准</p>"
  }
}
```

### 备注

获取指定故事的详细信息。
