# 更新产品

**分类:** 产品管理
**路径:** `PUT /api.php/v1/products/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 产品ID |
| name | string | 否 | 产品名称 |
| code | string | 否 | 产品代码 |
| type | string | 否 | 产品类型 |
| PO | string | 否 | 产品负责人 |
| QD | string | 否 | 计划截止日期 |
| RD | string | 否 | 实际截止日期 |
| desc | string | 否 | 产品描述 |
| acl | string | 否 | 访问控制 |

### 请求示例

```json
PUT /api.php/v1/products/2
Content-Type: application/json

{
  "name": "新产品系统（已更新）",
  "desc": "更新的产品描述"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 产品ID |
| name | string | 产品名称 |
| code | string | 产品代码 |
| status | string | 产品状态 |

### 响应示例

```json
{
  "product": {
    "id": 2,
    "name": "新产品系统（已更新）",
    "code": "newproduct",
    "status": "normal"
  }
}
```

### 备注

更新产品信息。仅需提供需要修改的字段。
