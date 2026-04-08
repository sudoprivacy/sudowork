# Chandao (禅道) API v1 Endpoints Index


## Token（认证）

- [获取Token](v1/tokens/create.md) — `POST /api.php/v1/tokens`

## 用户 (User)

- [当前用户信息](v1/users/profile.md) — `GET /api.php/v1/user`
- [用户列表](v1/users/list.md) — `GET /api.php/v1/users`
- [用户详情](v1/users/detail.md) — `GET /api.php/v1/users/{id}`
- [创建用户](v1/users/create.md) — `POST /api.php/v1/users`
- [修改用户](v1/users/update.md) — `PUT /api.php/v1/users/{id}`
- [删除用户](v1/users/delete.md) — `DELETE /api.php/v1/users/{id}`

## 产品 (Product)

- [产品列表](v1/products/list.md) — `GET /api.php/v1/products`
- [产品详情](v1/products/detail.md) — `GET /api.php/v1/products/{id}`
- [创建产品](v1/products/create.md) — `POST /api.php/v1/products`
- [修改产品](v1/products/update.md) — `PUT /api.php/v1/products/{id}`
- [删除产品](v1/products/delete.md) — `DELETE /api.php/v1/products/{id}`

## 需求/用户故事 (Story)

- [需求列表](v1/stories/list.md) — `GET /api.php/v1/products/{productID}/stories`
- [需求详情](v1/stories/detail.md) — `GET /api.php/v1/stories/{id}`
- [创建需求](v1/stories/create.md) — `POST /api.php/v1/products/{productID}/stories`
- [修改需求](v1/stories/update.md) — `PUT /api.php/v1/stories/{id}`
- [删除需求](v1/stories/delete.md) — `DELETE /api.php/v1/stories/{id}`
- [关闭需求](v1/stories/actions/close.md) — `POST /api.php/v1/stories/{id}/close`

## 项目 (Project)

- [项目列表](v1/projects/list.md) — `GET /api.php/v1/projects`
- [项目详情](v1/projects/detail.md) — `GET /api.php/v1/projects/{id}`
- [创建项目](v1/projects/create.md) — `POST /api.php/v1/projects`
- [修改项目](v1/projects/update.md) — `PUT /api.php/v1/projects/{id}`
- [删除项目](v1/projects/delete.md) — `DELETE /api.php/v1/projects/{id}`

## 迭代/执行 (Execution)

- [迭代列表](v1/executions/list.md) — `GET /api.php/v1/projects/{projectID}/executions`
- [迭代详情](v1/executions/detail.md) — `GET /api.php/v1/executions/{id}`
- [创建迭代](v1/executions/create.md) — `POST /api.php/v1/projects/{projectID}/executions`
- [修改迭代](v1/executions/update.md) — `PUT /api.php/v1/executions/{id}`
- [删除迭代](v1/executions/delete.md) — `DELETE /api.php/v1/executions/{id}`

## 任务 (Task)

- [任务列表](v1/tasks/list.md) — `GET /api.php/v1/executions/{executionID}/tasks`
- [任务详情](v1/tasks/detail.md) — `GET /api.php/v1/tasks/{id}`
- [创建任务](v1/tasks/create.md) — `POST /api.php/v1/executions/{executionID}/tasks`
- [修改任务](v1/tasks/update.md) — `PUT /api.php/v1/tasks/{id}`
- [删除任务](v1/tasks/delete.md) — `DELETE /api.php/v1/tasks/{id}`
- [开始任务](v1/tasks/actions/start.md) — `POST /api.php/v1/tasks/{id}/start`
- [暂停任务](v1/tasks/actions/pause.md) — `POST /api.php/v1/tasks/{id}/pause`
- [继续任务](v1/tasks/actions/restart.md) — `POST /api.php/v1/tasks/{id}/restart`
- [完成任务](v1/tasks/actions/finish.md) — `POST /api.php/v1/tasks/{id}/finish`
- [关闭任务](v1/tasks/actions/close.md) — `POST /api.php/v1/tasks/{id}/close`
- [记录工时](v1/tasks/actions/effort.md) — `POST /api.php/v1/tasks/{id}/effort`

## Bug

- [Bug列表](v1/bugs/list.md) — `GET /api.php/v1/products/{productID}/bugs`
- [Bug详情](v1/bugs/detail.md) — `GET /api.php/v1/bugs/{id}`
- [创建Bug](v1/bugs/create.md) — `POST /api.php/v1/products/{productID}/bugs`
- [修改Bug](v1/bugs/update.md) — `PUT /api.php/v1/bugs/{id}`
- [删除Bug](v1/bugs/delete.md) — `DELETE /api.php/v1/bugs/{id}`
- [确认Bug](v1/bugs/actions/confirm.md) — `POST /api.php/v1/bugs/{id}/confirm`
- [解决Bug](v1/bugs/actions/resolve.md) — `POST /api.php/v1/bugs/{id}/resolve`
- [关闭Bug](v1/bugs/actions/close.md) — `POST /api.php/v1/bugs/{id}/close`
- [激活Bug](v1/bugs/actions/activate.md) — `POST /api.php/v1/bugs/{id}/activate`

## 测试用例 (TestCase)

- [用例列表](v1/testcases/list.md) — `GET /api.php/v1/products/{productID}/testcases`
- [用例详情](v1/testcases/detail.md) — `GET /api.php/v1/testcases/{id}`
- [创建用例](v1/testcases/create.md) — `POST /api.php/v1/products/{productID}/testcases`
- [修改用例](v1/testcases/update.md) — `PUT /api.php/v1/testcases/{id}`
- [删除用例](v1/testcases/delete.md) — `DELETE /api.php/v1/testcases/{id}`

## 测试单 (TestTask)

- [测试单列表](v1/testtasks/list.md) — `GET /api.php/v1/testtasks` 或 `GET /api.php/v1/projects/{projectID}/testtasks`
- [测试单详情](v1/testtasks/detail.md) — `GET /api.php/v1/testtasks/{id}`

## 项目集 (Program)

- [项目集列表](v1/programs/list.md) — `GET /api.php/v1/programs`
- [项目集详情](v1/programs/detail.md) — `GET /api.php/v1/programs/{id}`
- [创建项目集](v1/programs/create.md) — `POST /api.php/v1/programs`
- [修改项目集](v1/programs/update.md) — `PUT /api.php/v1/programs/{id}`
- [删除项目集](v1/programs/delete.md) — `DELETE /api.php/v1/programs/{id}`

## 版本 (Build)

- [版本列表](v1/builds/list.md) — `GET /api.php/v1/projects/{projectID}/builds`
- [版本详情](v1/builds/detail.md) — `GET /api.php/v1/builds/{id}`
- [创建版本](v1/builds/create.md) — `POST /api.php/v1/executions/{executionID}/builds`
- [修改版本](v1/builds/update.md) — `PUT /api.php/v1/builds/{id}`
- [删除版本](v1/builds/delete.md) — `DELETE /api.php/v1/builds/{id}`

## 发布 (Release)

- [发布列表](v1/releases/list.md) — `GET /api.php/v1/products/{productID}/releases`
- [发布详情](v1/releases/detail.md) — `GET /api.php/v1/releases/{id}`

## 产品计划 (ProductPlan)

- [计划列表](v1/productplans/list.md) — `GET /api.php/v1/products/{productID}/plans`
- [计划详情](v1/productplans/detail.md) — `GET /api.php/v1/productplans/{id}`
- [创建计划](v1/productplans/create.md) — `POST /api.php/v1/products/{productID}/plans`
- [修改计划](v1/productplans/update.md) — `PUT /api.php/v1/productplans/{id}`
- [删除计划](v1/productplans/delete.md) — `DELETE /api.php/v1/productplans/{id}`
- [关联需求](v1/productplans/linkStories.md) — `POST /api.php/v1/productplans/{id}/linkStories`
- [取消关联需求](v1/productplans/unlinkStories.md) — `POST /api.php/v1/productplans/{id}/unlinkStories`
- [关联Bug](v1/productplans/linkBugs.md) — `POST /api.php/v1/productplans/{id}/linkBugs`
- [取消关联Bug](v1/productplans/unlinkBugs.md) — `POST /api.php/v1/productplans/{id}/unlinkBugs`

## 部门 (Department)

- [部门列表](v1/departments/list.md) — `GET /api.php/v1/departments`
- [部门详情](v1/departments/detail.md) — `GET /api.php/v1/departments/{id}`

## 反馈 (Feedback)

- [反馈列表](v1/feedbacks/list.md) — `GET /api.php/v1/feedbacks`
- [反馈详情](v1/feedbacks/detail.md) — `GET /api.php/v1/feedbacks/{id}`
- [创建反馈](v1/feedbacks/create.md) — `POST /api.php/v1/feedbacks`
- [修改反馈](v1/feedbacks/update.md) — `PUT /api.php/v1/feedbacks/{id}`
- [删除反馈](v1/feedbacks/delete.md) — `DELETE /api.php/v1/feedbacks/{id}`

## 工单 (Ticket) ⚠️ 企业版

- [工单列表](v1/tickets/list.md) — `GET /api.php/v1/tickets`
- [工单详情](v1/tickets/detail.md) — `GET /api.php/v1/tickets/{id}`
- [创建工单](v1/tickets/create.md) — `POST /api.php/v1/tickets`
- [修改工单](v1/tickets/update.md) — `PUT /api.php/v1/tickets/{id}`
- [删除工单](v1/tickets/delete.md) — `DELETE /api.php/v1/tickets/{id}`

> 工单模块在云禅道开源版中返回 403，仅限企业版/旗舰版。
