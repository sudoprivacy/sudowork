# 项目列表

**分类:** 项目管理
**路径:** `GET /api.php/v1/projects`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |
| status | string | 否 | 项目状态(all/undone/wait/doing/suspended/closed) |

### 请求示例

```json
GET /api.php/v1/projects?page=1&limit=20&status=doing
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| projects | array | 项目列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 8,
  "limit": 20,
  "projects": [
    {
      "id": 1,
      "name": "2024年第一季度产品迭代",
      "code": "q1-2024",
      "model": "scrum",
      "type": "feature",
      "status": "doing",
      "begin": "2024-01-01",
      "end": "2024-03-31",
      "PM": "1",
      "progress": 65,
      "estimate": 480,
      "consumed": 312,
      "left": 168,
      "teamCount": 8
    }
  ]
}
```

### 备注

获取项目列表。支持按状态进行筛选。显示项目的工作量、进度等统计信息。
