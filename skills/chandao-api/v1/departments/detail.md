# 部门详情

**分类:** 组织管理
**路径:** `GET /api.php/v1/departments/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 部门ID |

### 请求示例

```json
GET /api.php/v1/departments/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 部门ID |
| name | string | 部门名称 |
| manager | string | 部门经理ID |
| desc | string | 部门描述 |
| members | int | 成员数 |
| budget | string | 部门预算 |

### 响应示例

```json
{
  "department": {
    "id": 1,
    "name": "研发部",
    "manager": "1",
    "desc": "负责产品开发及维护",
    "members": 12,
    "budget": "500000"
  }
}
```

### 备注

获取指定部门的详细信息。
