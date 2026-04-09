# 测试用例列表

**分类:** 测试管理
**路径:** `GET /api.php/v1/products/{productID}/testcases`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| productID | int | 是 | 产品ID |
| page | int | 否 | 页码，默认为1 |
| limit | int | 否 | 每页数量，默认为20 |

### 请求示例

```json
GET /api.php/v1/products/1/testcases?page=1&limit=20
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| page | int | 当前页码 |
| total | int | 总记录数 |
| limit | int | 每页数量 |
| testcases | array | 测试用例列表 |

### 响应示例

```json
{
  "page": 1,
  "total": 25,
  "limit": 20,
  "testcases": [
    {
      "id": 1,
      "title": "登录功能测试",
      "type": "feature",
      "pri": 1,
      "precondition": "系统已启动",
      "steps": "[{\"desc\": \"输入用户名\", \"expect\": \"输入框有聚焦效果\"}]"
    }
  ]
}
```

### 备注

获取指定产品下的测试用例列表。
