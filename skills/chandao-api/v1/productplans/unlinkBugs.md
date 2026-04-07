# 取消关联Bug

**分类:** 产品规划
**路径:** `POST /api.php/v1/productplans/{id}/unlinkBugs`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 产品计划ID |
| bugs | array | 是 | BugID数组 |

### 请求示例

```json
POST /api.php/v1/productplans/1/unlinkBugs
Content-Type: application/json

{
  "bugs": [1]
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
  "bugs": 7,
  "message": "Bug关联已取消"
}
```

### 备注

取消指定Bug与计划的关联。

⚠️ **此接口在云禅道开源版 18.12 中返回 404。** 关联/取消关联操作建议通过 Web 界面进行，或使用 PUT 修改计划来间接实现。
