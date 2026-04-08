# 部门列表

**分类:** 组织管理
**路径:** `GET /api.php/v1/departments`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |

### 请求示例

```json
GET /api.php/v1/departments?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| departments | array | 部门列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 5,
  "limit": 20,
  "departments": [
    {
      "id": 1,
      "name": "研发部",
      "manager": "1",
      "desc": "负责产品开发",
      "members": 12
    },
    {
      "id": 2,
      "name": "测试部",
      "manager": "3",
      "desc": "负责产品测试",
      "members": 8
    }
  ]
}
```

### 备注

获取部门列表。
