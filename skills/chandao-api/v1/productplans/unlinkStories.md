# 取消关联故事

**分类:** 产品规划
**路径:** `POST /api.php/v1/productplans/{id}/unlinkStories`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 产品计划ID |
| stories | array | 是 | 故事ID数组 |

### 请求示例

```json
POST /api.php/v1/productplans/1/unlinkStories
Content-Type: application/json

{
  "stories": [1, 2]
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 产品计划ID |
| stories | int | 关联的故事数 |
| message | string | 提示信息 |

### 响应示例

```json
{
  "id": 1,
  "stories": 22,
  "message": "故事关联已取消"
}
```

### 备注

取消指定故事与计划的关联。

⚠️ **此接口在云禅道开源版 18.12 中返回 404。** 关联/取消关联操作建议通过 Web 界面进行，或使用 PUT 修改计划来间接实现。
