# 产品计划详情

**分类:** 产品规划
**路径:** `GET /api.php/v1/productplans/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 产品计划ID |

### 请求示例

```json
GET /api.php/v1/productplans/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 产品计划ID |
| title | string | 计划标题 |
| begin | string | 开始日期 |
| end | string | 结束日期 |
| status | string | 计划状态 |
| desc | string | 计划描述 |
| stories | int | 关联故事数 |
| bugs | int | 关联bug数 |

### 响应示例

```json
{
  "plan": {
    "id": 1,
    "title": "Q1产品规划",
    "begin": "2024-01-01",
    "end": "2024-03-31",
    "status": "active",
    "desc": "第一季度的产品规划",
    "stories": 24,
    "bugs": 8
  }
}
```

### 备注

获取指定产品计划的详细信息。
