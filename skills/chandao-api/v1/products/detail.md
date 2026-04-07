# 产品详情

**分类:** 产品管理
**路径:** `GET /api.php/v1/products/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 产品ID |

### 请求示例

```json
GET /api.php/v1/products/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 产品ID |
| name | string | 产品名称 |
| code | string | 产品代码 |
| type | string | 产品类型(normal/platform/branch) |
| status | string | 产品状态 |
| PO | string | 产品负责人 |
| QD | string | 计划截止日期 |
| RD | string | 实际截止日期 |
| desc | string | 产品描述 |
| acl | string | 访问控制(private/open) |
| totalStories | int | 总故事数 |
| activeStories | int | 活跃故事数 |
| unresolvedBugs | int | 未解决bug数 |
| totalBugs | int | 总bug数 |
| plans | int | 计划数 |
| releases | int | 版本数 |

### 响应示例

```json
{
  "product": {
    "id": 1,
    "name": "ZenTao项目管理",
    "code": "zentao",
    "type": "normal",
    "status": "normal",
    "PO": "1",
    "QD": "2024-01-01",
    "RD": "2024-06-01",
    "desc": "功能齐全的项目管理系统",
    "acl": "open",
    "totalStories": 120,
    "activeStories": 45,
    "unresolvedBugs": 8,
    "totalBugs": 156,
    "plans": 3,
    "releases": 2
  }
}
```

### 备注

获取指定产品的详细信息及统计数据。
