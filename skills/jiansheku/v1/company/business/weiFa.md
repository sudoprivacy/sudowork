# 企业工商严重违法

**分类:** 失信信息
**路径:** `POST /v1/company/business/weiFa`
**Content-Type:** `application/json`

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| companyName | string | 是 | 企业名称 |
| isHistory | number | 是 | 是否历史数据：0:非历史， 1:历史，不传全部 |
| pageIndex | number | 是 | 当前页 |
| pageSize | number | 是 |  |
| creditCode | string | 是 | 统一社会信用代码 |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 | 响应码 |
| data | object | 是 | 响应数据 |
| list | array | 是 | 数组 |
| executedPerson | array | 是 | 失信被执行人 |
| execution | array | 是 | 严重违法失信企业名单（黑名单）信息  |
| majorTaxViolatio | array | 是 | 重大税收违法案件信息  |
| totalCount | number | 是 | 总条数 |
| msg | string | 是 | 响应消息 |
| outDepartment | string | 是 | 作出决定机关（移出） |
| outDate | string | 是 | 移出日期 |
| inDate | string | 是 | 列入日期 |
| illType | string | 是 | 违法类别 |
| inDepartment | string | 是 | 作出决定机关（列入） |
| inReason | string | 是 | 列入严重违法失信企业名单（黑名单）原因 |
| outReason | string | 是 | 移出严重违法失信企业名单（黑名单）原因 |
