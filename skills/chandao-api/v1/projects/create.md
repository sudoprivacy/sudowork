# 创建项目

**分类:** 项目管理
**路径:** `POST /api.php/v1/projects`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| name | string | 是 | 项目名称 |
| code | string | 否 | 项目代码 |
| begin | string | 是 | 开始日期(YYYY-MM-DD) |
| end | string | 是 | 结束日期(YYYY-MM-DD) |
| products | array | 否 | 关联的产品ID数组 |
| model | string | 否 | 项目模式(scrum/waterfall/kanban)，默认scrum |
| PM | string | 否 | 项目经理ID |
| desc | string | 否 | 项目描述 |

### 请求示例

```json
POST /api.php/v1/projects
Content-Type: application/json

{
  "name": "2024年第二季度产品迭代",
  "code": "q2-2024",
  "begin": "2024-04-01",
  "end": "2024-06-30",
  "products": [1, 2],
  "model": "scrum",
  "PM": "1",
  "desc": "第二季度的新功能开发"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新项目ID |
| name | string | 项目名称 |
| code | string | 项目代码 |
| model | string | 项目模式 |
| status | string | 项目状态 |

### 响应示例

```json
{
  "project": {
    "id": 2,
    "name": "2024年第二季度产品迭代",
    "code": "q2-2024",
    "model": "scrum",
    "status": "undone"
  }
}
```

### 备注

创建新项目。name、begin和end为必填项。日期格式为YYYY-MM-DD。
