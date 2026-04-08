# 更新Bug

**分类:** Bug管理
**路径:** `PUT /api.php/v1/bugs/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | BugID |
| title | string | 否 | Bug标题 |
| severity | int | 否 | 严重程度 |
| pri | int | 否 | 优先级 |
| type | string | 否 | Bug类型 |
| steps | string | 否 | 重现步骤 |
| assignedTo | string | 否 | 分配人 |
| status | string | 否 | Bug状态 |

### 请求示例

```json
PUT /api.php/v1/bugs/1
Content-Type: application/json

{
  "title": "登录页面样式错位（已更新）",
  "severity": 3,
  "pri": 1
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | BugID |
| title | string | Bug标题 |
| severity | int | 严重程度 |

### 响应示例

```json
{
  "bug": {
    "id": 1,
    "title": "登录页面样式错位（已更新）",
    "severity": 3
  }
}
```

### 备注

更新Bug信息。只需提供需要修改的字段。
