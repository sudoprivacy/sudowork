# 任务详情

**分类:** 任务管理
**路径:** `GET /api.php/v1/tasks/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 任务ID |

### 请求示例

```json
GET /api.php/v1/tasks/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 任务ID |
| execution | int | 迭代ID |
| name | string | 任务名称 |
| type | string | 任务类型 |
| pri | int | 优先级 |
| estimate | int | 工作量估算 |
| consumed | int | 已消耗工作量 |
| left | int | 剩余工作量 |
| deadline | string | 截止日期 |
| status | string | 任务状态 |
| assignedTo | string | 分配人 |
| estStarted | string | 计划开始日期 |
| realStarted | string | 实际开始日期 |

### 响应示例

```json
{
  "task": {
    "id": 1,
    "execution": 1,
    "name": "用户登录模块开发",
    "type": "devel",
    "pri": 1,
    "estimate": 16,
    "consumed": 12,
    "left": 4,
    "deadline": "2024-01-10",
    "status": "doing",
    "assignedTo": "1",
    "estStarted": "2024-01-01",
    "realStarted": "2024-01-02"
  }
}
```

### 备注

获取指定任务的详细信息。
