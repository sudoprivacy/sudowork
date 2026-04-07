# 更新版本构建

**分类:** 版本管理
**路径:** `PUT /api.php/v1/builds/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 版本构建ID |
| name | string | 否 | 版本名称 |
| date | string | 否 | 构建日期 |
| desc | string | 否 | 版本描述 |
| status | string | 否 | 版本构建状态 |

### 请求示例

```json
PUT /api.php/v1/builds/1
Content-Type: application/json

{
  "name": "v1.0.1",
  "desc": "紧急修复版本"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 版本构建ID |
| name | string | 版本名称 |
| desc | string | 版本描述 |

### 响应示例

```json
{
  "build": {
    "id": 1,
    "name": "v1.0.1",
    "desc": "紧急修复版本"
  }
}
```

### 备注

更新版本构建信息。只需提供需要修改的字段。
