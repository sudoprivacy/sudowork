# Chandao/ZenTao REST API v1 文档

完整的Chandao（禅道）REST API v1版本的端点文档。

## 目录结构

本文档包含以下模块的API端点：

### 用户管理 (users/)
- `profile.md` - 获取当前用户信息
- `list.md` - 用户列表
- `detail.md` - 用户详情
- `create.md` - 创建用户
- `update.md` - 更新用户
- `delete.md` - 删除用户

### 产品管理 (products/)
- `list.md` - 产品列表
- `detail.md` - 产品详情
- `create.md` - 创建产品
- `update.md` - 更新产品
- `delete.md` - 删除产品

### 故事管理 (stories/)
- `list.md` - 故事列表
- `detail.md` - 故事详情
- `create.md` - 创建故事
- `update.md` - 更新故事
- `delete.md` - 删除故事
- `actions/close.md` - 关闭故事

### 项目管理 (projects/)
- `list.md` - 项目列表
- `detail.md` - 项目详情
- `create.md` - 创建项目
- `update.md` - 更新项目
- `delete.md` - 删除项目

### 迭代管理 (executions/)
- `list.md` - 迭代列表
- `detail.md` - 迭代详情
- `create.md` - 创建迭代
- `update.md` - 更新迭代
- `delete.md` - 删除迭代

### 任务管理 (tasks/)
- `list.md` - 任务列表
- `detail.md` - 任务详情
- `create.md` - 创建任务
- `update.md` - 更新任务
- `delete.md` - 删除任务
- `actions/start.md` - 开始任务
- `actions/pause.md` - 暂停任务
- `actions/restart.md` - 重启任务
- `actions/finish.md` - 完成任务
- `actions/close.md` - 关闭任务
- `actions/effort.md` - 记录工作日志

### Bug管理 (bugs/)
- `list.md` - Bug列表
- `detail.md` - Bug详情
- `create.md` - 创建Bug
- `update.md` - 更新Bug
- `delete.md` - 删除Bug
- `actions/confirm.md` - 确认Bug
- `actions/resolve.md` - 解决Bug
- `actions/close.md` - 关闭Bug
- `actions/activate.md` - 激活Bug

### 测试用例 (testcases/)
- `list.md` - 测试用例列表
- `detail.md` - 测试用例详情
- `create.md` - 创建测试用例
- `update.md` - 更新测试用例
- `delete.md` - 删除测试用例

### 测试任务 (testtasks/)
- `list.md` - 测试任务列表
- `detail.md` - 测试任务详情

### 项目集管理 (programs/)
- `list.md` - 项目集列表
- `detail.md` - 项目集详情
- `create.md` - 创建项目集
- `update.md` - 更新项目集
- `delete.md` - 删除项目集

### 版本构建 (builds/)
- `list.md` - 版本构建列表
- `detail.md` - 版本构建详情
- `create.md` - 创建版本构建
- `update.md` - 更新版本构建
- `delete.md` - 删除版本构建

### 发布版本 (releases/)
- `list.md` - 发布版本列表
- `detail.md` - 发布版本详情

### 产品计划 (productplans/)
- `list.md` - 产品计划列表
- `detail.md` - 产品计划详情
- `create.md` - 创建产品计划
- `update.md` - 更新产品计划
- `delete.md` - 删除产品计划
- `linkStories.md` - 关联故事到计划
- `unlinkStories.md` - 取消关联故事
- `linkBugs.md` - 关联Bug到计划
- `unlinkBugs.md` - 取消关联Bug

### 部门管理 (departments/)
- `list.md` - 部门列表
- `detail.md` - 部门详情

### 反馈管理 (feedbacks/)
- `list.md` - 反馈列表
- `detail.md` - 反馈详情
- `create.md` - 创建反馈
- `update.md` - 更新反馈
- `delete.md` - 删除反馈

### 工作单管理 (tickets/)
- `list.md` - 工作单列表
- `detail.md` - 工作单详情
- `create.md` - 创建工作单
- `update.md` - 更新工作单
- `delete.md` - 删除工作单

## 文档格式

每个端点文档遵循以下格式：

```
# 标题

**分类:** 分类名
**路径:** `METHOD /api.php/v1/path`
**Content-Type:** `application/json`

### 请求参数
(参数表格或"无")

### 请求示例
(JSON示例)

### 响应参数
(响应字段表格)

### 响应示例
(JSON示例)

### 备注
(说明文字)
```

## 通用说明

- 所有请求和响应均使用JSON格式
- API基础URL: `/api.php/v1`
- 需要在请求头中包含适当的认证信息
- 所有日期格式为YYYY-MM-DD
- 分页查询默认limit为20

## 总计

共计87个API端点文档，覆盖Chandao/ZenTao系统的主要功能模块。
