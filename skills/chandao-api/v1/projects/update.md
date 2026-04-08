# 更新项目

**分类:** 项目管理
**路径:** `PUT /api.php/v1/projects/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 项目ID |
| name | string | 否 | 项目名称 |
| code | string | 否 | 项目代码 |
| begin | string | 否 | 开始日期 |
| end | string | 否 | 结束日期 |
| model | string | 否 | 项目模式 |
| PM | string | 否 | 项目经理 |
| desc | string | 否 | 项目描述 |
| status | string | 否 | 项目状态 |

### 请求示例

```json
PUT /api.php/v1/projects/1
Content-Type: application/json

{
  "name": "2024年第一季度产品迭代（已更新）",
  "status": "suspended"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 项目ID |
| name | string | 项目名称 |
| status | string | 项目状态 |

### 响应示例

```json
{
  "project": {
    "id": 1,
    "name": "2024年第一季度产品迭代（已更新）",
    "status": "suspended"
  }
}
```

### 备注

更新项目信息。只需提供需要修改的字段。
