# 创建Bug

**分类:** Bug管理
**路径:** `POST /api.php/v1/products/{productID}/bugs`
**Content-Type:** `application/json`

### 请求参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| productID | int | 是 | 产品ID |
| title | string | 是 | Bug标题 |
| severity | int | 是 | 严重程度(1-4) |
| pri | int | 是 | 优先级(1-4) |
| type | string | 是 | Bug类型(codeerror/config/install/security/performance/standard/automation/designdefect/others) |
| openedBuild | string | 是 | 报告版本(如"trunk"表示主干) |
| steps | string | 否 | 重现步骤(HTML) |
| assignedTo | string | 否 | 分配人ID |
| execution | int | 否 | 关联迭代ID |
| story | int | 否 | 关联故事ID |
| task | int | 否 | 关联任务ID |

### 请求示例

```json
POST /api.php/v1/products/1/bugs
Content-Type: application/json

{
  "title": "登录页面样式错位",
  "severity": 2,
  "pri": 2,
  "type": "codeerror",
  "openedBuild": "trunk",
  "steps": "<p>1. 打开登录页面\n2. 刷新页面\n3. 观察样式异常</p>",
  "assignedTo": "2"
}
```

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 新BugID |
| title | string | Bug标题 |
| severity | int | 严重程度 |
| status | string | Bug状态 |

### 响应示例

```json
{
  "bug": {
    "id": 2,
    "title": "登录页面样式错位",
    "severity": 2,
    "status": "active"
  }
}
```

### 备注

在指定产品下创建新Bug。title、severity、pri、type、openedBuild为必填项。
