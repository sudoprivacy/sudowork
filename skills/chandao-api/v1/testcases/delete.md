# 删除测试用例

**分类:** 测试管理
**路径:** `DELETE /api.php/v1/testcases/{id}`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| id | int | 是 | 测试用例ID |

### 请求示例

```json
DELETE /api.php/v1/testcases/1
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| status | string | 状态 |
| message | string | 提示信息 |

### 响应示例

```json
{
  "status": "success",
  "message": "测试用例已删除"
}
```

### 备注

删除指定测试用例。
