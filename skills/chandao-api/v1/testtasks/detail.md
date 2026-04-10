# 测试任务详情

**分类:** 测试管理
**路径:** `GET /api.php/v1/testtasks/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 测试任务ID |

### 请求示例

```json
GET /api.php/v1/testtasks/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 测试任务ID |
| name | string | 测试任务名称 |
| product | int | 产品ID |
| begin | string | 开始日期 |
| end | string | 结束日期 |
| status | string | 测试任务状态 |
| testcases | int | 测试用例数 |
| progress | int | 进度百分比 |

### 响应示例

```json
{
  "testtask": {
    "id": 1,
    "name": "Sprint 1测试",
    "product": 1,
    "begin": "2024-01-01",
    "end": "2024-01-14",
    "status": "doing",
    "testcases": 25,
    "progress": 72
  }
}
```

### 备注

获取指定测试任务的详细信息。
