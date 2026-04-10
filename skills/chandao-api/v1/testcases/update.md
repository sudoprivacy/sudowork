# 更新测试用例

**分类:** 测试管理
**路径:** `PUT /api.php/v1/testcases/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 测试用例ID |
| title | string | 否 | 用例标题 |
| type | string | 否 | 用例类型 |
| pri | int | 否 | 优先级 |
| precondition | string | 否 | 前置条件 |
| steps | array | 否 | 步骤数组 |
| story | int | 否 | 关联故事 |

### 请求示例

```json
PUT /api.php/v1/testcases/1
Content-Type: application/json

{
  "title": "登录功能测试（已更新）",
  "pri": 2
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 测试用例ID |
| title | string | 用例标题 |
| pri | int | 优先级 |

### 响应示例

```json
{
  "testcase": {
    "id": 1,
    "title": "登录功能测试（已更新）",
    "pri": 2
  }
}
```

### 备注

更新测试用例信息。只需提供需要修改的字段。
