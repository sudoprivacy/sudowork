# 关联Bug到计划

**分类:** 产品规划
**路径:** `POST /api.php/v1/productplans/{id}/linkBugs`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 产品计划ID |
| bugs | array | 是 | BugID数组 |

### 请求示例

```json
POST /api.php/v1/productplans/1/linkBugs
Content-Type: application/json

{
  "bugs": [1, 2]
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 产品计划ID |
| bugs | int | 关联的Bug数 |
| message | string | 提示信息 |

### 响应示例

```json
{
  "id": 1,
  "bugs": 8,
  "message": "Bug已关联"
}
```

### 备注

将指定的Bug关联到计划。可关联多个Bug。

⚠️ **此接口在云禅道开源版 18.12 中返回 404。** 关联/取消关联操作建议通过 Web 界面进行，或使用 PUT 修改计划来间接实现。
