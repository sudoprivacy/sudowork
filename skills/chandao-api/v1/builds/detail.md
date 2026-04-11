# 版本构建详情

**分类:** 版本管理
**路径:** `GET /api.php/v1/builds/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 版本构建ID |

### 请求示例

```json
GET /api.php/v1/builds/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 版本构建ID |
| name | string | 版本名称 |
| product | int | 产品ID |
| date | string | 构建日期 |
| status | string | 构建状态 |
| desc | string | 版本描述 |

### 响应示例

```json
{
  "build": {
    "id": 1,
    "name": "v1.0.0",
    "product": 1,
    "date": "2024-01-10",
    "status": "success",
    "desc": "第一个正式版本发布"
  }
}
```

### 备注

获取指定版本构建的详细信息。
