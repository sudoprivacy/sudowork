# 更新迭代

**分类:** 迭代管理
**路径:** `PUT /api.php/v1/executions/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 迭代ID |
| name | string | 否 | 迭代名称 |
| code | string | 否 | 迭代代码 |
| begin | string | 否 | 开始日期 |
| end | string | 否 | 结束日期 |
| status | string | 否 | 迭代状态 |

### 请求示例

```json
PUT /api.php/v1/executions/1
Content-Type: application/json

{
  "name": "Sprint 1（已调整）",
  "status": "doing"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 迭代ID |
| name | string | 迭代名称 |
| status | string | 迭代状态 |

### 响应示例

```json
{
  "execution": {
    "id": 1,
    "name": "Sprint 1（已调整）",
    "status": "doing"
  }
}
```

### 备注

更新迭代信息。只需提供需要修改的字段。
