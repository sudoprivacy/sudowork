# 企业中标公示搜索

**分类:** 招投标信息
**路径:** `POST /v1/company/bidding/ebps`
**Content-Type:** `application/json`

通过企业名称/企业id/企业统一社会信用代码/项目所在省/中标时间等条件，查询该企业的中标公示数据。

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| cid | string | 否 | 企业id |
| projectName | string | 否 | 项目名称/项目名称关键词 |
| province | string | 否 | 项目所在省 |
| bidWinTimeStart | string | 否 | 中标时间（开始） |
| bidWinTimeEnd | string | 否 | 中标时间（结束） |
| buildingProjectType | string | 否 | 建筑工程项目类型 |
| pageIndex | string | 否 | 页数 |
| pageSize | string | 否 | 条数 |
| companyName | string | 否 | 企业名称 |
| creditCode | string | 否 | 企业统一社会信用代码 |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | object | 是 |  |
| list | array | 是 |  |
| agency | string | 是 | 招标代理机构 |
| agencyContact | string | 是 | 招标代理机构联系人 |
| agencyId | string | 是 | 招标代理机构id |
| agencyTel | string | 是 | 招标代理机构联系方式 |
| area | string | 是 | 项目所在区县 |
| bidWinAmount | number | 是 | 中标金额（万元） |
| bidWinCompany | string | 是 | 中标单位id |
| bidWinCompanyId | string | 是 | 中标单位id |
| bidWinContact | string | 是 | 中标单位联系人 |
| bidWinContactTel | string | 是 | 中标单位联系方式 |
| bidWinTime | string | 是 | 中标时间 |
| buildingProjectType | string | 是 | 建筑工程项目类型 |
| city | string | 是 | 项目所在市 |
| downfloatRate | number | 是 | 下浮率（%） |
| md5 | string | 是 | 项目id |
| projectDuration | number | 是 | 工期（天） |
| projectName | string | 是 | 项目名称 |
| province | string | 是 | 项目所在省 |
| serviceWay | string | 是 | 标的物类型 |
| tenderWay | string | 是 | 招标方式 |
| tenderee | string | 是 | 招标单位 |
| tendereeContact | string | 是 | 招标单位联系人 |
| tendereeId | string | 是 | 招标单位id |
| tendereeTel | string | 是 | 招标单位联系方式 |
| url | string | 是 | 原文链接 |
| totalCount | number | 是 | 总条数 |
| msg | string | 是 | 信息 |
