# 项目详情

**分类:** 项目管理
**路径:** `GET /api.php/v1/projects/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 项目ID |

### 请求示例

```json
GET /api.php/v1/projects/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 项目ID |
| name | string | 项目名称 |
| code | string | 项目代码 |
| model | string | 项目模式(scrum/waterfall/kanban) |
| type | string | 项目类型 |
| status | string | 项目状态 |
| begin | string | 开始日期 |
| end | string | 结束日期 |
| PM | string | 项目经理 |
| progress | int | 进度百分比 |
| estimate | int | 估计工作量 |
| consumed | int | 已消耗工作量 |
| left | int | 剩余工作量 |
| teamCount | int | 团队成员数 |

### 响应示例

```json
{
  "project": {
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
}
```

### 备注

获取指定项目的详细信息，包括进度、工作量等数据。
