---
name: chandao-api
description: >
  禅道 (ZenTao/Chandao) REST API v1 integration — project management platform providing
  87 endpoints across 17 categories covering products, projects, executions (sprints),
  tasks, bugs, stories/requirements, test cases, builds, releases, and more.
  Use this skill whenever the user wants to: interact with ZenTao/禅道/chandao via API,
  create or query tasks/bugs/stories in 禅道, automate project management workflows,
  build integrations that read or write ZenTao data, or manage sprints and iterations
  programmatically. Also trigger when the user mentions 禅道, chandao, zentao, 任务管理,
  缺陷管理, 需求管理, 迭代管理, or any ZenTao project management API interaction.
  Tested against ZenTao 18.12 on 云禅道 (chandao.net). Note: only REST API v1 is
  supported on 云禅道 open-source edition; v2 API requires enterprise edition.
---

# 禅道 REST API v1 集成指南

## 一、凭证获取与配置

调用禅道 API 需要三个参数：**实例地址**、**账号**和**密码**。

### 凭证在哪里配置

脚本按以下顺序查找凭证：

1. **环境变量**（优先）：`CHANDAO_BASE_URL`、`CHANDAO_ACCOUNT`、`CHANDAO_PASSWORD`
2. **`.env` 文件**（回退）：`skills/chandao-api/.env`

**推荐方式：** 在技能目录下创建 `.env` 文件：

```
CHANDAO_BASE_URL=https://your-site.chandao.net
CHANDAO_ACCOUNT=your_username
CHANDAO_PASSWORD=your_password
```

**如果凭证缺失：** 脚本会报错并提示。此时应向用户索取禅道实例地址、用户名和密码。

### 检查凭证是否可用

```bash
python scripts/chandao.py --check
```

或直接调用：

```bash
curl -s -X POST https://your-site.chandao.net/api.php/v1/tokens \
  -H "Content-Type: application/json" \
  -d '{"account": "username", "password": "password"}'
```

- 返回 `{"token": "..."}` → 凭证正常
- 返回 HTML 错误页 → 实例地址不正确
- 返回 `{"error": "..."}` → 账号密码不正确

## 二、SDK 使用方法

SDK 文件位于 `scripts/chandao.py`，Token 管理（获取、自动续期）已全部封装，agent 只需关注调用。

### Python 代码调用

```python
from chandao import Chandao

api = Chandao("https://your-site.chandao.net", "username", "password")

# GET 请求 — 查询
products = api.get("/products")                    # 产品列表
tasks = api.get("/executions/2/tasks")             # 迭代下的任务
bug = api.get("/bugs/42")                          # Bug 详情

# POST 请求 — 创建
bug = api.post("/products/1/bugs", {
    "title": "页面崩溃",
    "severity": 2,
    "pri": 1,
    "type": "codeerror",
    "openedBuild": "trunk",
    "steps": "<p>重现步骤</p>"
})

# PUT 请求 — 修改
api.put("/tasks/1", {"pri": 1, "estimate": 8})

# POST 请求 — 动作（开始/完成/关闭等）
api.action("/tasks/1/start")
api.action("/tasks/1/finish", {"consumed": 4, "left": 0})
api.action("/bugs/1/resolve", {"resolution": "fixed"})
api.action("/bugs/1/close")

# 便捷方法
api.list_products()                                # 产品列表
api.list_projects(status="doing")                  # 进行中的项目
api.list_tasks(execution_id=2)                     # 迭代任务
api.list_bugs(product_id=1)                        # 产品 Bug
api.list_stories(product_id=1)                     # 产品需求
api.my_profile()                                   # 当前用户信息
```

### 响应说明

- 列表接口返回分页结构：`{"page": 1, "total": N, "limit": 20, "items": [...]}`
  - `items` 的 key 名随接口变化：`products`, `bugs`, `tasks`, `stories`, `users` 等
- 详情/创建/修改接口直接返回对象
- 错误返回：`{"error": "错误信息"}`
- Token 有效期 1440 秒（24 分钟），SDK 自动在 20 分钟时刷新

## 三、接口概览

完整接口索引见 `INDEX.md`，每个接口的详细参数见 `v1/` 目录下对应的 .md 文件。

### 按模块分类

| 模块 | 接口数 | 说明 |
|------|--------|------|
| Token（认证） | 1 | 获取 API Token |
| 用户 (User) | 6 | 用户 CRUD + 个人信息 |
| 产品 (Product) | 5 | 产品 CRUD |
| 需求 (Story) | 7 | 需求/用户故事 CRUD + 关闭 |
| 项目 (Project) | 5 | 项目 CRUD |
| 迭代 (Execution) | 5 | Sprint/迭代 CRUD |
| 任务 (Task) | 11 | CRUD + 开始/暂停/继续/完成/关闭/工时 |
| Bug | 9 | CRUD + 确认/解决/关闭/激活 |
| 测试用例 (TestCase) | 5 | 用例 CRUD |
| 测试单 (TestTask) | 2 | 列表 + 详情 |
| 项目集 (Program) | 5 | 项目集 CRUD |
| 版本 (Build) | 5 | 版本 CRUD |
| 发布 (Release) | 2 | 列表 + 详情 |
| 产品计划 (ProductPlan) | 10 | CRUD + 关联/取消关联需求和 Bug |
| 部门 (Department) | 2 | 列表 + 详情 |
| 反馈 (Feedback) | 5 | 反馈 CRUD |
| 工单 (Ticket) | 5 | 工单 CRUD |

### 常用场景快速参考

**场景 A：创建一个完整的迭代（Sprint）**

```python
# 1. 创建产品
product = api.post("/products", {"name": "我的产品", "type": "normal"})

# 2. 创建项目
project = api.post("/projects", {
    "name": "Q2 项目",
    "begin": "2026-04-01",
    "end": "2026-06-30",
    "products": [product["id"]]
})

# 3. 创建迭代
sprint = api.post(f"/projects/{project['id']}/executions", {
    "name": "Sprint 1",
    "begin": "2026-04-01",
    "end": "2026-04-14",
    "products": [product["id"]]
})

# 4. 创建需求
story = api.post(f"/products/{product['id']}/stories", {
    "title": "用户登录功能",
    "type": "story",
    "category": "feature",
    "pri": 2,
    "estimate": 8
})

# 5. 创建任务
task = api.post(f"/executions/{sprint['id']}/tasks", {
    "name": "开发登录页面",
    "type": "devel",
    "assignedTo": "zhoujinjing",
    "estimate": 4,
    "estStarted": "2026-04-01",
    "deadline": "2026-04-07",
    "story": story["id"]
})
```

**场景 B：Bug 生命周期管理**

```python
# 创建 Bug
bug = api.post("/products/1/bugs", {
    "title": "登录失败无提示",
    "severity": 2,
    "pri": 1,
    "type": "codeerror",
    "openedBuild": "trunk",
    "steps": "<p>1. 输入错误密码<br>2. 点击登录<br>3. 无任何提示</p>"
})

# 确认 → 解决 → 关闭
api.action(f"/bugs/{bug['id']}/confirm")
api.action(f"/bugs/{bug['id']}/resolve", {"resolution": "fixed"})
api.action(f"/bugs/{bug['id']}/close")
```

**场景 C：查询项目进度**

```python
# 获取所有进行中的项目
projects = api.list_projects(status="doing")
for p in projects:
    print(f"{p['name']}: 进度 {p['progress']}%, 消耗 {p['consumed']}h")

    # 获取每个项目的迭代
    executions = api.list_executions(p["id"])
    for e in executions:
        tasks = api.list_tasks(e["id"])
        done = sum(1 for t in tasks if t["status"] == "done")
        print(f"  {e['name']}: {done}/{len(tasks)} 任务完成")
```

## 四、API 版本与已知限制

- **REST API v1** — 云禅道开源版（18.x）支持，本技能使用此版本
- **REST API v2** — 需要企业版/旗舰版，云禅道开源版调用会报 `Class 'xxxEntry' not found` 错误
- 可通过 `GET /?mode=getconfig` 获取实例版本号（返回 `{"version": "18.12", ...}`）

### 已知限制

1. **文档库（Doc/Wiki）API 只读不写**
   - `GET /doclibs` 和 `GET /docs?lib={id}` 可用
   - `POST /doclibs`、`POST /docs` 返回 200 但无效果
   - **创建文档库/文档需通过浏览器自动化**（ai-dev-browser）

2. **DELETE /docs/{id} 返回 success 但不生效**
   - API 返回 `{"message":"success"}` 但文档的 `deleted` 字段仍为 0
   - **删除文档需通过浏览器访问 `doc-delete-{id}.html`**

3. **创建任务必须包含 `estStarted` 字段**
   - 不传会报错：`『预计开始』不能为空`

4. **添加项目团队成员**
   - 通过 `PUT /projects/{id}` 传 `{"team": ["username"]}` 实现
   - API 文档中未记录此字段，但实测有效

## 五、浏览器自动化（补充 API 不支持的操作）

当 API 不支持某些操作时，使用 ai-dev-browser 通过 CDP 协议控制浏览器完成。

### 登录

```python
from ai_dev_browser.core.browser import start_browser
start_browser(port=9222, profile='jarvis')
```

然后通过 `page_goto` 导航到登录页，用 JS 填写表单并点击登录。

### 创建文档库

```bash
# 导航到创建库页面
page_goto --url "https://site.chandao.net/doc-createLib-project-{PROJECT_ID}.html"

# 在 iframe (#appIframe-doc) 中填写库名称并点击保存
js_exec: doc.querySelector('#name').value = '库名称'; doc.querySelector('button:contains(保存)').click();
```

### 删除文档

```bash
# 直接访问删除 URL，自动接受确认对话框
Page.navigate → doc-delete-{DOC_ID}.html
Page.handleJavaScriptDialog → accept: true
```

### 上传文件到文档

```bash
# 1. 导航到创建文档页面
page_goto → doc-create-0-0-project-{LIB_ID}.html

# 2. 在 iframe 中填写标题
js_exec: doc.querySelector('#editorTitle').value = '标题';

# 3. 通过 CDP DOM.setFileInputFiles 设置文件
Runtime.evaluate → 获取 #file-input-multiple 的 objectId
DOM.describeNode → 获取 backendNodeId
DOM.setFileInputFiles → files: ['/path/to/file'], backendNodeId: ...

# 4. 点击发布（两步）
js_exec: doc.querySelector('#basicInfoLink').click();  // 打开发布面板
js_exec: doc.querySelector('#releaseBtn').click();      // 确认发布
```
