# 更新产品计划

**分类:** 产品规划
**路径:** `PUT /api.php/v1/productplans/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 产品计划ID |
| title | string | 否 | 计划标题 |
| begin | string | 否 | 开始日期 |
| end | string | 否 | 结束日期 |
| desc | string | 否 | 计划描述 |
| status | string | 否 | 计划状态 |

### 请求示例

```json
PUT /api.php/v1/productplans/1
Content-Type: application/json

{
  "title": "Q1产品规划（已调整）"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 产品计划ID |
| title | string | 计划标题 |
| status | string | 计划状态 |

### 响应示例

```json
{
  "plan": {
    "id": 1,
    "title": "Q1产品规划（已调整）",
    "status": "wait"
  }
}
```

### 备注

更新产品计划信息。只需提供需要修改的字段。

⚠️ **注意事项（云禅道开源版 18.12）：**
- **不要传 `status` 字段**：API 对 `status` 字段的验证存在 Bug，无论传入什么值（`wait`、`doing`、`done`、`closed`）都会返回格式错误 `{"error":"Format of status is incorrect"}`。如需修改状态，请通过禅道 Web 界面操作。
- 其他字段（`title`、`begin`、`end`、`desc`）可正常修改。
