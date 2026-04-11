# 社保信息查询

**分类:** 工商信息
**路径:** `POST /v1/company/industrial/sbxx`
**Content-Type:** `application/json`

根据企业关键字和年份查询

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| cid | number | 否 | 企业id  企业名称/统一社会信用代码/企业id任选其一输入 |
| reportYear | number | 否 | 年报年份 |
| companyName | string | 否 | 企业名称 企业名称/统一社会信用代码/企业id任选其一输入 |
| creditCode | string | 否 | 企业统一社会信用代码 企业名称/统一社会信用代码/企业id任选其一输入 |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | object | 是 |  |
| actualEmploymentInjuryPaidAmount | string | 是 | 参加工伤保险本期实际缴费金额 |
| actualLostPaidAmount | string | 是 | 参加失业保险本期实际缴费金额 |
| actualMedicalPaidAmount | string | 是 | 参加职工基本医疗保险本期实际缴费金额 |
| baseMedicalUnpaidAmount | string | 是 | 单位参加职工基本医疗保险累计欠缴金额 |
| birthActualAmount | string | 是 | 参加生育保险本期实际缴费金额 |
| birthNumber | string | 是 | 生育保险人数 |
| birthPaymentBase | string | 是 | 单位参加生育保险缴费基数 |
| birthUnpaidAmount | string | 是 | 单位参加生育保险累计欠缴金额 |
| companyName | string | 是 | 企业名称 |
| creditCode | string | 是 | 企业统一社会信用代码 |
| employmentInjuryNumber | string | 是 | 工伤保险人数 |
| employmentInjuryPaymentBase | string | 是 | 单位参加工伤保险缴费基数 |
| employmentInjuryUnpaidAmount | string | 是 | 单位参加工伤保险累计欠缴金额 |
| endownmentInsuranceNumber | string | 是 | 城镇职工基本养老保险人数 |
| endownmentInsurancePaidAmount | string | 是 | 参加城镇职工基本养老保险本期实际缴费金额 |
| endownmentInsuranceUnpaidAmount | string | 是 | 单位参加城镇职工基本养老保险累计欠缴金额 |
| endownmentPaymentBase | string | 是 | 单位参加城镇职工基本养老保险缴费基数 |
| insuredNumber | string | 是 | 参保人数 |
| medicalAmount | string | 是 | 单位参加职工基本医疗保险缴费基数 |
| medicalNumber | string | 是 | 职工基本医疗保险人数 |
| oneYearGrowthRate | string | 是 | 近一年参保人数增长率 |
| reportDate | string | 是 | 发布日期 |
| reportYear | number | 是 | 年报年份 |
| threeYearGrowthRate | string | 是 | 近三年参保人数增长率 |
| twoYearGrowthRate | string | 是 | 近两年参保人数增长率 |
| unenploymentNumber | string | 是 | 失业保险人数 |
| unenploymentPaymentBase | string | 是 | 单位参加失业保险缴费基数 |
| unenploymentUnpaidAmount | string | 是 | 单位参加失业保险累计欠缴金额 |
| msg | string | 是 |  |
