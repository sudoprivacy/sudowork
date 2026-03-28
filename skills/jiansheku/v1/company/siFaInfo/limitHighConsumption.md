# 限制高消费

**分类:** 司法涉诉
**路径:** `POST /v1/company/siFaInfo/limitHighConsumption`
**Content-Type:** `application/json`

通过企业id/企业名称/统一社会信用代码，查询企业限制高消费信息，包括被限制消费人姓名、立案时间、案由等

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| cid | string | 否 | 企业cid |
| isHistory | string | 否 | 是否为历史数据 0非历史；1历史 |
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
| caseNo | string | 是 | 案号 |
| caseReason | string | 是 | 案由 |
| content | string | 是 | 限消正文 |
| court | string | 是 | 执行法院 |
| executionApplicant | string | 是 | 申请执行人 |
| isHistory | string | 是 | 是否为历史数据  0非历史  1历史 |
| issueTime | string | 是 | 限制令发布日期 |
| name | string | 是 | 限制高消费人 |
| registerDate | string | 是 | 立案时间 |
| relatedCompanyName | string | 是 | 限消人企业 |
| sex | string | 是 | 性别 |
| totalCount | number | 是 | 总条数 |
| msg | string | 是 |  |
