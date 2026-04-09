# 发布版本详情

**分类:** 版本管理
**路径:** `GET /api.php/v1/releases/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 发布版本ID |

### 请求示例

```json
GET /api.php/v1/releases/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 发布版本ID |
| name | string | 发布版本名称 |
| product | int | 产品ID |
| date | string | 发布日期 |
| status | string | 版本状态 |
| description | string | 版本说明 |

### 响应示例

```json
{
  "release": {
    "id": 1,
    "name": "v1.0.0",
    "product": 1,
    "date": "2024-01-10",
    "status": "released",
    "description": "产品首个正式版本"
  }
}
```

### 备注

获取指定发布版本的详细信息。
