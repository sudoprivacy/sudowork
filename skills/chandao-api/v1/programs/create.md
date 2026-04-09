# 创建项目集

**分类:** 项目集管理
**路径:** `POST /api.php/v1/programs`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| name | string | 是 | 项目集名称 |
| begin | string | 否 | 开始日期(YYYY-MM-DD) |
| end | string | 否 | 结束日期(YYYY-MM-DD) |
| PM | string | 否 | 项目经理ID |
| desc | string | 否 | 项目集描述 |

### 请求示例

```json
POST /api.php/v1/programs
Content-Type: application/json

{
  "name": "2025年产品线规划",
  "begin": "2025-01-01",
  "end": "2025-12-31",
  "PM": "1",
  "desc": "2025年全年产品开发规划"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新项目集ID |
| name | string | 项目集名称 |
| status | string | 项目集状态 |

### 响应示例

```json
{
  "program": {
    "id": 2,
    "name": "2025年产品线规划",
    "status": "planning"
  }
}
```

### 备注

创建新项目集。name为必填项。
