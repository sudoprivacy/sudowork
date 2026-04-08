# 测试用例详情

**分类:** 测试管理
**路径:** `GET /api.php/v1/testcases/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 测试用例ID |

### 请求示例

```json
GET /api.php/v1/testcases/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 测试用例ID |
| title | string | 用例标题 |
| type | string | 用例类型 |
| pri | int | 优先级 |
| precondition | string | 前置条件 |
| steps | array | 步骤数组 |
| story | int | 关联故事ID |

### 响应示例

```json
{
  "testcase": {
    "id": 1,
    "title": "登录功能测试",
    "type": "feature",
    "pri": 1,
    "precondition": "系统已启动",
    "steps": [
      {"desc": "输入用户名", "expect": "输入框有聚焦效果"},
      {"desc": "输入密码", "expect": "密码显示为点状"},
      {"desc": "点击登录", "expect": "跳转到首页"}
    ],
    "story": 1
  }
}
```

### 备注

获取指定测试用例的详细信息。
