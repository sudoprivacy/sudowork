# 域名

**分类:** 知识产权
**路径:** `POST /v1/company/zhiShi/domains`
**Content-Type:** `application/json`

通过社会信用代码，查询此企业域名信息。

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| companyName | string | 否 | 企业名称 |
| creditCode | string | 否 | 企业统一社会信用代码 |
| cid | number | 否 | 企业id |
| pageIndex | string | 否 | 页数 |
| pageSize | string | 否 | 条数 |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | object | 是 |  |
| list | array | 是 |  |
| homeUrl | string | 是 | 网站首页地址 |
| number | string | 是 | 网站备案许可证 |
| updateTime | number | 是 | 修改时间 |
| bodyName | string | 是 | 主办单位名称 |
| domain | string | 是 | 域名 |
| respPerson | string | 是 | 负责人 |
| siteName | string | 是 | 网站名称 |
| source | string | 是 | 来源 |
| checkDate | string | 是 | 登记批准时间 |
| type | string | 是 | 主办单位性质 |
| totalCount | number | 是 | 总条数 |
| msg | string | 是 |  |
