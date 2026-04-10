# 创建产品

**分类:** 产品管理
**路径:** `POST /api.php/v1/products`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| name | string | 是 | 产品名称 |
| code | string | 否 | 产品代码 |
| type | string | 否 | 产品类型(normal/platform/branch)，默认normal |
| PO | string | 否 | 产品负责人 |
| QD | string | 否 | 计划截止日期 |
| RD | string | 否 | 实际截止日期 |
| desc | string | 否 | 产品描述 |
| acl | string | 否 | 访问控制(private/open)，默认open |

### 请求示例

```json
POST /api.php/v1/products
Content-Type: application/json

{
  "name": "新产品系统",
  "code": "newproduct",
  "type": "normal",
  "PO": "1",
  "QD": "2024-12-31",
  "desc": "这是一个新的产品系统",
  "acl": "private"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新产品ID |
| name | string | 产品名称 |
| code | string | 产品代码 |
| type | string | 产品类型 |
| status | string | 产品状态 |

### 响应示例

```json
{
  "product": {
    "id": 2,
    "name": "新产品系统",
    "code": "newproduct",
    "type": "normal",
    "status": "normal"
  }
}
```

### 备注

创建新产品。产品名称必须唯一。
