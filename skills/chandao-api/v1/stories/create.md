# 创建故事

**分类:** 故事管理
**路径:** `POST /api.php/v1/products/{productID}/stories`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| productID | int | 是 | 产品ID |
| title | string | 是 | 故事标题 |
| type | string | 是 | 类型(story/requirement) |
| category | string | 是 | 分类(feature/interface/performance/safe/experience/improve/other) |
| pri | int | 否 | 优先级(1-4)，默认为3 |
| estimate | int | 否 | 工作量估算 |
| spec | string | 否 | 规格说明(HTML) |
| verify | string | 否 | 验收标准(HTML) |
| assignedTo | string | 否 | 分配人ID |

### 请求示例

```json
POST /api.php/v1/products/1/stories
Content-Type: application/json

{
  "title": "用户登录功能",
  "type": "story",
  "category": "feature",
  "pri": 1,
  "estimate": 8,
  "spec": "<p>实现用户登录功能</p>",
  "verify": "<p>验收标准</p>",
  "assignedTo": "1"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新故事ID |
| title | string | 故事标题 |
| type | string | 类型 |
| category | string | 分类 |
| status | string | 故事状态 |

### 响应示例

```json
{
  "story": {
    "id": 2,
    "title": "用户登录功能",
    "type": "story",
    "category": "feature",
    "status": "active"
  }
}
```

### 备注

在指定产品下创建新故事。title、type和category为必填项。
