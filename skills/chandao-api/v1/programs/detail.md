# 项目集详情

**分类:** 项目集管理
**路径:** `GET /api.php/v1/programs/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 项目集ID |

### 请求示例

```json
GET /api.php/v1/programs/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 项目集ID |
| name | string | 项目集名称 |
| begin | string | 开始日期 |
| end | string | 结束日期 |
| PM | string | 项目经理 |
| status | string | 项目集状态 |
| desc | string | 项目集描述 |
| projects | int | 关联项目数 |

### 响应示例

```json
{
  "program": {
    "id": 1,
    "name": "2024年产品线规划",
    "begin": "2024-01-01",
    "end": "2024-12-31",
    "PM": "1",
    "status": "active",
    "desc": "涵盖所有产品线的年度规划",
    "projects": 8
  }
}
```

### 备注

获取指定项目集的详细信息。
