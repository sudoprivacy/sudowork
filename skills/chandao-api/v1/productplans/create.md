# 创建产品计划

**分类:** 产品规划
**路径:** `POST /api.php/v1/products/{productID}/plans`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| productID | int | 是 | 产品ID |
| title | string | 是 | 计划标题 |
| begin | string | 否 | 开始日期(YYYY-MM-DD) |
| end | string | 否 | 结束日期(YYYY-MM-DD) |
| desc | string | 否 | 计划描述 |

### 请求示例

```json
POST /api.php/v1/products/1/plans
Content-Type: application/json

{
  "title": "Q2产品规划",
  "begin": "2024-04-01",
  "end": "2024-06-30",
  "desc": "第二季度的产品规划及新功能开发"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新产品计划ID |
| title | string | 计划标题 |
| status | string | 计划状态 |

### 响应示例

```json
{
  "plan": {
    "id": 2,
    "title": "Q2产品规划",
    "status": "undone"
  }
}
```

### 备注

在指定产品下创建新计划。title为必填项。
