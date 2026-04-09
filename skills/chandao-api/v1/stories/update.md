# 更新故事

**分类:** 故事管理
**路径:** `PUT /api.php/v1/stories/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 故事ID（路径参数） |
| title | string | 否 | 故事标题 |
| type | string | 否 | 类型 |
| category | string | 否 | 分类 |
| pri | int | 否 | 优先级 |
| estimate | int | 否 | 工作量估算 |
| spec | string | 否 | 规格说明 |
| verify | string | 否 | 验收标准 |
| assignedTo | string | 否 | 分配人 |
| reviewer | array | **是** | 评审人账号数组，如 `["admin"]`。**必须提供，否则更新可能失败** |
| status | string | 否 | 状态 |

### 请求示例

```json
PUT /api.php/v1/stories/1
Content-Type: application/json

{
  "title": "用户登录功能（已更新）",
  "pri": 2,
  "estimate": 10,
  "reviewer": ["admin"]
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| (空响应体) | — | 成功时返回 HTTP 200，但响应体为空（Content-Length: 0） |

### 响应示例

```
HTTP/1.1 200 OK
Content-Length: 0
```

### 备注

更新故事信息。只需提供需要修改的字段。

⚠️ **注意事项（云禅道开源版 18.12）：**
- **`reviewer` 字段为必填**，必须传入账号数组（如 `["admin"]`），否则更新会失败。
- **成功响应体为空**：HTTP 状态码 200，但 Content-Length 为 0，不返回 JSON。调用方应以 HTTP 状态码判断是否成功，而非解析响应体。
- 可通过 `GET /api.php/v1/stories/{id}` 验证修改是否生效。
