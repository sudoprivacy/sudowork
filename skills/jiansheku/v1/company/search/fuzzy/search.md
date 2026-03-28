# 标准接口-企业模糊查询-搜索引擎版本

**分类:** 工商信息
**路径:** `POST /v1/company/search/fuzzy/search`
**Content-Type:** `application/json`

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| companyName | string | 是 | 企业名称 |
| pageIndex | string | 是 | 页数 |
| pageSize | string | 是 | 条数 |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | object | 是 |  |
| list | array | 是 |  |
| registerCity | string | 是 |  |
| projectCount | string | 是 | 业绩数量 |
| isISO | string | 是 |  |
| county | string | 是 |  |
| jdztzgCount | string | 是 |  |
| cityId | number | 是 | 市id |
| source | string | 是 |  |
| zzSxbzxCount | string | 是 |  |
| filePlaceType | string | 是 |  |
| recentlyCount | string | 是 |  |
| roadConservancy | string | 是 |  |
| liceCertNo | string | 是 |  |
| province | string | 是 |  |
| regionInfo | string | 是 |  |
| threePersonnelCount | string | 是 |  |
| zzRiskBidCount | string | 是 |  |
| certData | string | 是 |  |
| id | string | 是 | 企业cid |
| supplierCount | string | 是 |  |
| businessAddress | string | 是 |  |
| formerName | string | 是 |  |
| jmzyCount | string | 是 |  |
| actualCapi | string | 是 |  |
| businessScope | string | 是 | 经营范围 |
| registerProvince | string | 是 |  |
| provinceId | number | 是 |  |
| bidMaxAmount | string | 是 |  |
| logoUrl | string | 是 | 企业logo地址 |
| skyCount | string | 是 |  |
| labels | string | 是 |  |
| certificateExpireCount | string | 是 |  |
| companyId | string | 是 |  |
| domicileCity | string | 是 |  |
| liceIssueDate | string | 是 |  |
| aptitudeCountNew | string | 是 |  |
| phone | string | 是 |  |
| registrationType | string | 是 |  |
| topSupplierId | string | 是 |  |
| bidSumAmount | string | 是 |  |
| name | string | 是 | 企业名称 |
| filePlaceCode | string | 是 |  |
| jskBidCount | string | 是 |  |
| zdsswfCount | string | 是 |  |
| isEMS | string | 是 |  |
| aptitudeCount | number | 是 | 资质数量 |
| liceValidityDate | string | 是 |  |
| registeredCapitalStr | string | 是 |  |
| attn | string | 是 |  |
| isLocalC | string | 是 |  |
| no | string | 是 |  |
| other | string | 是 |  |
| registeredDate | string | 是 |  |
| city | string | 是 |  |
| topCustomerId | string | 是 |  |
| yqblxwjlCount | string | 是 |  |
| soonCertificateExpireCount | string | 是 |  |
| seriousAdminSanctionCount | number | 是 |  |
| isCountryCredit | string | 是 |  |
| zzZfcgsxCount | string | 是 |  |
| nameSimple | string | 是 | 简称 |
| creditCode | string | 是 | 社会信用代码 |
| badCreditChinaCount | string | 是 |  |
| rate | string | 是 |  |
| registeredCapital | string | 是 |  |
| countyId | number | 是 |  |
| legalPerson | string | 是 | 法人 |
| lessCert | string | 是 |  |
| zzJdcgsxCount | string | 是 |  |
| domicileNum | string | 是 |  |
| companyType | string | 是 |  |
| regionList | string | 是 |  |
| rateTime | string | 是 |  |
| businessStatus | string | 是 | 企业状态 |
| seriousIllegalCount | string | 是 |  |
| url | string | 是 |  |
| waterConservancy | string | 是 |  |
| isLocal | string | 是 |  |
| isOHSMS | string | 是 |  |
| persionCount | string | 是 | 人员数量 |
| regionId | string | 是 |  |
| liceValidDay | string | 是 |  |
| registeredPersonnelCount | string | 是 |  |
| behaviorTypeCount | string | 是 |  |
| domicile | string | 是 |  |
| jskEid | number | 是 | 企业cid |
| numPunish | string | 是 |  |
| phoneCount | string | 是 |  |
| customerCount | string | 是 |  |
| totalCount | number | 是 |  |
| msg | string | 是 |  |
