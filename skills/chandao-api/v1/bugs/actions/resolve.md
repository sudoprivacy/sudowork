# 解决Bug

**分类:** Bug管理
**路径:** `POST /api.php/v1/bugs/{id}/resolve`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | BugID |
| resolution | string | 是 | 解决方案(fixed/bydesign/duplicate/external/willnotfix/notrepro/postponed/tostory) |

### 请求示例

```json
POST /api.php/v1/bugs/1/resolve
Content-Type: application/json

{
  "resolution": "fixed"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | BugID |
| status | string | Bug状态 |
| resolution | string | 解决方案 |

### 响应示例

```json
{
  "id": 1,
  "status": "resolved",
  "resolution": "fixed"
}
```

### 备注

解决Bug。resolution参数指定了解决的方式。fixed表示已修复、bydesign表示按设计、duplicate表示重复等。
