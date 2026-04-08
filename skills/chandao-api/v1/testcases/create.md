# 创建测试用例

**分类:** 测试管理
**路径:** `POST /api.php/v1/products/{productID}/testcases`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| productID | int | 是 | 产品ID |
| title | string | 是 | 用例标题 |
| type | string | 是 | 用例类型(feature/performance/config/install/security/other) |
| pri | int | 否 | 优先级(1-4)，默认为3 |
| precondition | string | 否 | 前置条件 |
| steps | array | 否 | 步骤数组，每个步骤为{desc, expect} |
| story | int | 否 | 关联故事ID |

### 请求示例

```json
POST /api.php/v1/products/1/testcases
Content-Type: application/json

{
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
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新测试用例ID |
| title | string | 用例标题 |
| type | string | 用例类型 |
| status | string | 用例状态 |

### 响应示例

```json
{
  "testcase": {
    "id": 2,
    "title": "登录功能测试",
    "type": "feature",
    "status": "active"
  }
}
```

### 备注

在指定产品下创建新测试用例。title和type为必填项。
