# 关闭Bug

**分类:** Bug管理
**路径:** `POST /api.php/v1/bugs/{id}/close`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | BugID |

### 请求示例

```json
POST /api.php/v1/bugs/1/close
Content-Type: application/json

{}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | BugID |
| status | string | Bug状态 |
| message | string | 提示信息 |

### 响应示例

```json
{
  "id": 1,
  "status": "closed",
  "message": "Bug已关闭"
}
```

### 备注

关闭Bug。通常在Bug验证通过后执行。关闭后的Bug将从活跃列表中移除。
