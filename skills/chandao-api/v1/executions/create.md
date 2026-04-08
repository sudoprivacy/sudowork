# 创建迭代

**分类:** 迭代管理
**路径:** `POST /api.php/v1/projects/{projectID}/executions`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| projectID | int | 是 | 项目ID |
| name | string | 是 | 迭代名称 |
| code | string | 否 | 迭代代码 |
| begin | string | 是 | 开始日期(YYYY-MM-DD) |
| end | string | 是 | 结束日期(YYYY-MM-DD) |
| products | array | 否 | 关联产品ID数组 |

### 请求示例

```json
POST /api.php/v1/projects/1/executions
Content-Type: application/json

{
  "name": "Sprint 2",
  "code": "sprint-2",
  "begin": "2024-01-15",
  "end": "2024-01-28",
  "products": [1, 2]
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新迭代ID |
| name | string | 迭代名称 |
| code | string | 迭代代码 |
| status | string | 迭代状态 |

### 响应示例

```json
{
  "execution": {
    "id": 2,
    "name": "Sprint 2",
    "code": "sprint-2",
    "status": "undone"
  }
}
```

### 备注

在指定项目下创建新迭代。name、begin和end为必填项。
