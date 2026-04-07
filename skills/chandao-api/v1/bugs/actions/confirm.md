# 确认Bug

**分类:** Bug管理
**路径:** `POST /api.php/v1/bugs/{id}/confirm`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | BugID |

### 请求示例

```json
POST /api.php/v1/bugs/1/confirm
Content-Type: application/json

{}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | BugID |
| confirmed | boolean | 是否已确认 |
| message | string | 提示信息 |

### 响应示例

```json
{
  "id": 1,
  "confirmed": true,
  "message": "Bug已确认"
}
```

### 备注

确认Bug。确认后的Bug状态会相应更新。
