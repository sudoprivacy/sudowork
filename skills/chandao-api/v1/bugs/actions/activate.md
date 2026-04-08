# 激活Bug

**分类:** Bug管理
**路径:** `POST /api.php/v1/bugs/{id}/activate`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | BugID |

### 请求示例

```json
POST /api.php/v1/bugs/1/activate
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
  "status": "active",
  "message": "Bug已激活"
}
```

### 备注

重新激活已关闭或已解决的Bug。激活后Bug状态变更为活跃。

⚠️ **此接口在云禅道开源版 18.12 中返回 404。** 可能仅限企业版，或需要 Bug 处于特定状态（已关闭且非 `willnotfix`）。替代方案：通过 `PUT /api.php/v1/bugs/{id}` 修改。
