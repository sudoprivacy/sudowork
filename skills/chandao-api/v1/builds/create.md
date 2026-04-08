# 创建版本构建

**分类:** 版本管理
**路径:** `POST /api.php/v1/executions/{executionID}/builds`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| executionID | int | 是 | 迭代ID |
| name | string | 是 | 版本名称 |
| product | int | 是 | 产品ID |
| date | string | 否 | 构建日期(YYYY-MM-DD)，默认为当前日期 |
| desc | string | 否 | 版本描述 |

### 请求示例

```json
POST /api.php/v1/executions/1/builds
Content-Type: application/json

{
  "name": "v1.1.0",
  "product": 1,
  "date": "2024-01-20",
  "desc": "修复登录bug及优化界面"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新版本构建ID |
| name | string | 版本名称 |
| status | string | 版本构建状态 |

### 响应示例

```json
{
  "build": {
    "id": 2,
    "name": "v1.1.0",
    "status": "success"
  }
}
```

### 备注

在指定迭代下创建新版本构建。name和product为必填项。
