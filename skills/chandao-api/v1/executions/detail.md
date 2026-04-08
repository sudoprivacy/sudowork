# 迭代详情

**分类:** 迭代管理
**路径:** `GET /api.php/v1/executions/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 迭代ID |

### 请求示例

```json
GET /api.php/v1/executions/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 迭代ID |
| name | string | 迭代名称 |
| code | string | 迭代代码 |
| begin | string | 开始日期 |
| end | string | 结束日期 |
| status | string | 迭代状态 |
| tasks | int | 任务数 |
| progress | int | 进度百分比 |
| products | array | 关联产品 |

### 响应示例

```json
{
  "execution": {
    "id": 1,
    "name": "Sprint 1",
    "code": "sprint-1",
    "begin": "2024-01-01",
    "end": "2024-01-14",
    "status": "closed",
    "tasks": 32,
    "progress": 100,
    "products": [1, 2]
  }
}
```

### 备注

获取指定迭代的详细信息。
