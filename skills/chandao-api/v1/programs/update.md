# 更新项目集

**分类:** 项目集管理
**路径:** `PUT /api.php/v1/programs/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 项目集ID |
| name | string | 否 | 项目集名称 |
| begin | string | 否 | 开始日期 |
| end | string | 否 | 结束日期 |
| PM | string | 否 | 项目经理 |
| desc | string | 否 | 项目集描述 |
| status | string | 否 | 项目集状态 |

### 请求示例

```json
PUT /api.php/v1/programs/1
Content-Type: application/json

{
  "name": "2024年产品线规划（已调整）",
  "status": "closed"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 项目集ID |
| name | string | 项目集名称 |
| status | string | 项目集状态 |

### 响应示例

```json
{
  "program": {
    "id": 1,
    "name": "2024年产品线规划（已调整）",
    "status": "closed"
  }
}
```

### 备注

更新项目集信息。只需提供需要修改的字段。
