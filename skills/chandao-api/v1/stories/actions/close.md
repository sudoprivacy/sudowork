# 关闭故事

**分类:** 故事管理
**路径:** `POST /api.php/v1/stories/{id}/close`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 故事ID |

### 请求示例

```json
POST /api.php/v1/stories/1/close
Content-Type: application/json

{}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 故事ID |
| status | string | 故事状态 |
| message | string | 提示信息 |

### 响应示例

```json
{
  "id": 1,
  "status": "closed",
  "message": "故事已关闭"
}
```

### 备注

关闭指定故事。关闭后故事将标记为已完成状态。
