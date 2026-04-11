# 项目集列表

**分类:** 项目集管理
**路径:** `GET /api.php/v1/programs`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |

### 请求示例

```json
GET /api.php/v1/programs?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| programs | array | 项目集列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 3,
  "limit": 20,
  "programs": [
    {
      "id": 1,
      "name": "2024年产品线规划",
      "begin": "2024-01-01",
      "end": "2024-12-31",
      "PM": "1",
      "status": "active",
      "projects": 8
    }
  ]
}
```

### 备注

获取项目集列表。项目集是多个相关项目的集合。
