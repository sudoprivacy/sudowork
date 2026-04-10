# 查企业

**分类:** 经营信息
**路径:** `POST /v1/company/business/checkTheEnterprise`
**Content-Type:** `application/json`

## 查企业

### 接口描述
查企业信息

### 字符编码
UTF-8

### 请求地址
/v1/company/business/checkTheEnterprise

### 请求方式
POST(application/json)

### 请求参数

| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | List | - | 否 | 分页对象 |
| page.page | Integer | - | 否 | 页数 |
| page.limit | Integer | - | 否 | 条数 |
| aptitudeQueryDto | List | - | 否 | 资质对象 |
| aptitudeQueryDto.aptitudeCertNo | String | 255 | 否 | 查编号 |
| aptitudeQueryDto.industryCode | String | 255 | 否 | 行业code |
| aptitudeQueryDto.systemQueryType | String | 20 | 否 | 系统查询类型 or,and |
| aptitudeQueryDto.systemType | LIst | - | 否 | 例[1,2,3,4]，"1 质量管理体系认证（ISO9000）2 环境管理体系 3 职业安全管理体系 4建设施工行业质量管理体系认证" |
| aptitudeQueryDto.systemTypeStr | String | 255 | 否 | 例"1,2,3,4" 多个逗号隔开 1 质量管理体系认证（ISO9000）2 环境管理体系 3 职业安全管理体系 4建设施工行业质量管理体系认证" |
| aptitudeQueryDto.aptitudeQueryType | String | 20 | 否 | 各组之间同时具备任意均可or/and |
| aptitudeQueryDto.aptitudeDtoList.nameStr | String | 255 | 否 | 资质名称 |
| aptitudeQueryDto.aptitudeDtoList.codeStr | String | 255 | 否 | 资质code（53，157，3138-3139-3140） |
| aptitudeQueryDto.aptitudeDtoList.queryType | String | 20 | 否 | 组内and/or，有且只有only |
| aptitudeQueryDto.aptitudeType | String | 255 | 否 | 资质查询类型 qualification 按资质项 level 按等级 |
| aptitudeQueryDto.outCodeStr | String | 255 | 否 | 不包含的资质项code 多个逗号隔开 |
| aptitudeQueryDto.outQueryType | String | 255 | 否 | 不包含的资质项关系 同时具备and、任意均可or |
| aptitudeQueryDto.registeredCapital | String | 20 | 否 | 注册资金 |
| aptitudeQueryDto.leftRegisteredCapital | String | 20 | 否 | 注册资金 起 |
| aptitudeQueryDto.rightRegisteredCapital | String | 20 | 否 | 注册资金 止 |
| aptitudeQueryDto.leftActualCapi | String | 20 | 否 | 实缴资本 起 |
| aptitudeQueryDto.rightActualCapi | String | 20 | 否 | 实缴资本 止 |
| aptitudeQueryDto.domicile | String | 20 | 否 | 重庆 第一个选项 |
| aptitudeQueryDto.domicileNum | String | 20 | 否 | 备案地 代码 单选示例 500000 多选示例 重庆,500000 |
| aptitudeQueryDto.domicileCity | String | 20 | 否 | 本地的注册市 |
| aptitudeQueryDto.domicileCounty | String | 20 | 否 | 本地的注册区 |
| aptitudeQueryDto.registerProvince | String | 20 | 否 | 外地企业注册省 |
| aptitudeQueryDto.registerCity | String | 20 | 否 | 外地企业注册市 |
| aptitudeQueryDto.registerCounty | String | 20 | 否 | 外地企业注册区 |
| aptitudeQueryDto.ename | String | 20 | 否 | 企业名称/社会信用代码 |
| aptitudeQueryDto.resultEname | String | 20 | 否 | 企业结果搜索 |
| aptitudeQueryDto.businessScope | String | 255 | 否 | 经营范围 多个关键词空格隔开 |
| aptitudeQueryDto.businessStatus | String | 255 | 否 | 经营状态 多个关键词逗号隔开 |
| aptitudeQueryDto.businessScopeQueryType | String | 255 | 否 | 经营范围查询方式 |
| aptitudeQueryDto.isLocal | Integer | - | 否 | 是否本地 |
| aptitudeQueryDto.startInsuredNum | Integer | - | 否 | 参保人数 起 |
| aptitudeQueryDto.endInsuredNum | Integer | - | 否 | 参保人数 止 |
| aptitudeQueryDto.hasPhone | Integer | - | 否 | 是否有电话 0无 1有 2有手机号码 3有固定号码 4 有手机和固定号码 |
| aptitudeQueryDto.isHighTech | Integer | - | 否 | 是否高新技术企业，0否 1是 |
| aptitudeQueryDto.taxLvl | Integer | - | 否 | 税务登记 1 A级 |
| aptitudeQueryDto.taxYear | String | 255 | 否 | A级纳税人 年份 多个逗号隔开 |
| aptitudeQueryDto.hasAptitude | Integer | - | 否 | 有无资质 1有 2无 查资质到期时写死1 |
| aptitudeQueryDto.hasLiceCert | Integer | - | 否 | 有无安许证 1有 2无 |
| aptitudeQueryDto.companyType | Integer | - | 否 | 企业类型， 1 国有企业 2 集体企业 3 股份有限公司 4 有限责任公司 5 联营企业 6 港、澳、台商投资企业 7 私营企业 8 外商投资企业 9 个体工商户 10 股份制企业 11 事业单位 12 其他 |
| aptitudeQueryDto.startAptitudeValidityDate | String | 20 | 否 | 资质到期日期参数 开始 |
| aptitudeQueryDto.endAptitudeValidityDate | String | 20 | 否 | 资质到期日期参数 结束 |
| aptitudeQueryDto.startLiceValidityDate | String | 20 | 否 | 安许证日期参数 开始 |
| aptitudeQueryDto.endLiceValidityDate | String | 20 | 否 | 安许证日期参数 结束 |
| aptitudeQueryDto.liceCertNo | String | 255 | 否 | 安许证编号 |
| aptitudeQueryDto.startRegisteredDate | String | 20 | 否 | 成立日期 开始 |
| aptitudeQueryDto.endRegisteredDate | String | 20 | 否 | 成立日期 结束 |
| aptitudeQueryDto.filePlaceCode | Integer | - | 否 | 备案地code |
| aptitudeQueryDto.filePlaceType | Integer | - | 否 | 备案地类型 1 本省企业或外地备案 2 外地备案 3 本省企业 |
| aptitudeQueryDto.province | String | 255 | 否 | 注册地 省级code 多个逗号隔开 |
| aptitudeQueryDto.city | String | 255 | 否 | 注册地 市级code 多个逗号隔开 |
| aptitudeQueryDto.county | String | 255 | 否 | 注册地 区级code 多个逗号隔开 |
| aptitudeQueryDto.regionWeb | String | 255 | 否 | 备案网站 多个逗号隔开 |
| companyPersonnelCertQueryDto | List | - | 否 | 人员证书专查 |
| companyPersonnelCertQueryDto.queryType | String | 20 | 否 | 查询类别 and/or |
| companyPersonnelCertQueryDto.registers.registerQueryType | String | 20 | 否 | 注册查询类别 and/or |
| companyPersonnelCertQueryDto.registers.registerCount | Integer | - | 否 | 注册人数 |
| companyPersonnelCertQueryDto.registers.countType | Integer | - | 否 | 个数类型 1 大于等于 2 等于 3小于等于 |
| companyPersonnelCertQueryDto.registers.registerTypes.personType | String | 20 | 否 | siku_register 四库人员 other_register其他人员 |
| companyPersonnelCertQueryDto.registers.registerTypes.registerName | String | 20 | 否 | 注册证书名称 二级注册建造师 |
| companyPersonnelCertQueryDto.register.sregisterTypes.registerSpecialty | String | 20 | 否 | 注册专业 建筑工程 |


#### 请求示例

```
{
    "aptitudeQueryDto":{
        "queryType":"and",
        "nameStr":"",
        "aptitudeQueryType":"and",
        "businessScopeQueryType":"or",
        "filePlaceType":"1",
        "aptitudeType":"qualification",
        "aptitudeDtoList":[
            {
                "codeStr":"2",
                "queryType":"and"
            }
        ],
        "aptitudeSource":"new",
        "outCodeStr":"",
        "outQueryType":"and"
    },
    "page":{
        "page":1,
        "limit":2,
        "field":"",
        "order":""
    },
    "companyPersonnelCertQueryDto":{
        "queryType":"and",
        "registers":[
            {
                "registerCount":"",
                "countType":3,
                "registerTypes":[
                    {
                        "personType":"1",
                        "registerType":"",
                        "registerName":"建筑工程三类人员",
                        "registerSpecialty":"A类"
                    }
                ]
            }
        ]
    }
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| projectCount | Integer | - | 否 | 业绩总数 |
| recentlyCount | Integer | - | 否 | 中标业绩数 |
| liceCertNo | String | 255 | 否 | 安许证编号 |
| threePersonnelCount | Integer | - | 否 | 三类人员数 |
| id | Long | - | 否 | 企业id |
| supplierCount | Integer | - | 否 | 供应商数 |
| customerCount | Integer | - | 否 | 客户数 |
| businessAddress | String | 255 | 否 | 注册地址 |
| formerName | String | 255 | 否 | 曾用名 |
| logoUrl | String | 65535 | 否 | logo地址 |
| skyCount | Integer | - | 否 | 四库业绩数 |
| name | String | 255 | 否 | 企业名称 |
| jskBidCount | Integer | - | 否 | 招标公告数 |
| aptitudeCount | Integer | - | 否 | 资质数量 |
| aptitudeCountNew | Integer | - | 否 | 资质数量新 |
| liceValidityDate | String | 20 | 否 | 有效日期 |
| registeredCapitalStr | String | 20 | 否 | 注册资本 |
| registeredDate | String | 20 | 否 | 注册日期 |
| nameSimple | String | 255 | 否 | 企业简称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| legalPerson | String | 20 | 否 | 法人代表 |
| businessStatus | String | 20 | 否 | 经营状态 |
| persionCount | Integer | - | 否 | 人员数量 |
| liceIssueDate | String | 20 | 否 | 安许证有效期 |
| liceValidityDate | String | 20 | 否 | 安许证生效时间 |
| registeredPersonnelCount | Integer | - | 否 | 注册人员数 |
| companyType | String | 20 | 否 | 企业类型：1国有企业，2集体企业，3股份有限公司，4有限责任公司有限责任公司有限责任公司，5联营企业，6港、澳、台商投资企业，7私营企业私营企业，8外商投资企业，9个体工商户，10股份制企业股份制企业，11事业单位，12其他其他，13中央企业 |
| phone | String | 255 | 否 | 企业电话 |


#### 返回结果示例

```
{
  	"code": 200,
    "data": {
        "list": [
            {
                "registerCity": null,
                "projectCount": 13188,
                "isISO": null,
                "county": null,
                "source": null,
                "zzSxbzxCount": null,
                "filePlaceType": null,
                "recentlyCount": 1875,
                "liceCertNo": "（赣）JZ安许证字【2016】20028",
                "province": null,
                "regionInfo": null,
                "threePersonnelCount": 32,
                "zzRiskBidCount": null,
                "certData": null,
                "id": "45751",
                "supplierCount": 0,
                "businessAddress": "江西省赣州开发区华坚中路东侧综合楼三层",
                "formerName": null,
                "actualCapi": null,
                "businessScope": null,
                "registerProvince": null,
                "logoUrl": null,
                "skyCount": 6016,
                "labels": [
                    {
                        "pcode": "2_2_3_",
                        "level": 4,
                        "linkBizId": 211,
                        "num": 1,
                        "orderNum": 30,
                        "remark": null,
                        "isLeaf": 1,
                        "companyId": 45751,
                        "bgColor": "#E4F3FD",
                        "children": [],
                        "labelName": "勘察综合甲级",
                        "labelCode": "2_2_3_1_",
                        "fontColor": "#41A1FD"
                    },
                    {
                        "pcode": "3_2_",
                        "level": 3,
                        "linkBizId": null,
                        "num": 1,
                        "orderNum": 67,
                        "remark": "高新技术企业指在国家颁布的《国家重点支持的高新技术领域》范围内，持续进行研究开发与技术成果转化，形成企业核心自主知识产权，并以此为基础开展经营活动的居民企业，是知识密集、技术密集的经济实体。",
                        "isLeaf": 1,
                        "companyId": 45751,
                        "bgColor": "#FFF7EC",
                        "children": [],
                        "labelName": "高新技术企业",
                        "labelCode": "3_2_1_",
                        "fontColor": "#BFA061"
                    },
                    {
                        "pcode": "3_1_1_1_",
                        "level": 5,
                        "linkBizId": null,
                        "num": 1,
                        "orderNum": 77,
                        "remark": null,
                        "isLeaf": 1,
                        "companyId": 45751,
                        "bgColor": "#FFF7EC",
                        "children": [],
                        "labelName": "国家优质工程奖",
                        "labelCode": "3_1_1_1_2_",
                        "fontColor": "#BFA061"
                    },
                    {
                        "pcode": "1_1_",
                        "level": 3,
                        "linkBizId": null,
                        "num": 1,
                        "orderNum": 113,
                        "remark": null,
                        "isLeaf": 1,
                        "companyId": 45751,
                        "bgColor": "#F3F3FF",
                        "children": [],
                        "labelName": "华东",
                        "labelCode": "1_1_5_",
                        "fontColor": "#8491E8"
                    }
                ],
                "companyId": null,
                "domicileCity": null,
                "liceIssueDate": "2022-09-15",
                "aptitudeCountNew": 19,
                "phone": "0797-8088752,0797-8285361,0797-8401693",
                "registrationType": null,
                "name": "核工业赣州工程勘察设计集团有限公司",
                "filePlaceCode": null,
                "jskBidCount": 1,
                "isEMS": null,
                "aptitudeCount": 14,
                "liceValidityDate": "2025-09-15",
                "registeredCapitalStr": "10000",
                "attn": null,
                "isLocalC": null,
                "no": null,
                "other": null,
                "registeredDate": "1999-04-13",
                "city": null,
                "isCountryCredit": null,
                "zzZfcgsxCount": null,
                "nameSimple": null,
                "creditCode": "91360700160230358P",
                "badCreditChinaCount": null,
                "rate": null,
                "registeredCapital": 10000.0,
                "legalPerson": "张衎",
                "zzJdcgsxCount": null,
                "domicileNum": null,
                "companyType": "4",
                "regionList": null,
                "rateTime": null,
                "businessStatus": "在业",
                "seriousIllegalCount": null,
                "url": null,
                "isLocal": null,
                "isOHSMS": null,
                "persionCount": 73,
                "regionId": null,
                "liceValidDay": 901,
                "registeredPersonnelCount": 48,
                "domicile": "江西省-赣州市-赣州市",
                "jskEid": 45751,
                "numPunish": null,
                "customerCount": 689
            },
            {
                "registerCity": null,
                "projectCount": 9869,
                "isISO": null,
                "county": null,
                "source": null,
                "zzSxbzxCount": null,
                "filePlaceType": null,
                "recentlyCount": 1063,
                "liceCertNo": "D236154454",
                "province": null,
                "regionInfo": null,
                "threePersonnelCount": 66,
                "zzRiskBidCount": null,
                "certData": null,
                "id": "34944",
                "supplierCount": 0,
                "businessAddress": "江西省南昌市南昌高新技术产业开发区艾溪湖一路618号",
                "formerName": null,
                "actualCapi": null,
                "businessScope": null,
                "registerProvince": null,
                "logoUrl": null,
                "skyCount": 5624,
                "labels": [
                    {
                        "pcode": "4_",
                        "level": 2,
                        "linkBizId": null,
                        "num": 1,
                        "orderNum": 1,
                        "remark": "严重行政处罚，是指有关行政部门处以企业暂停投标资格、暂停承揽新业务的行政处罚。原因包括但不限于企业存在围标串标、克扣或拖欠劳动者报酬、出现重大安全事故等异常行为导致企业无法承揽工程项目，产生重大经营风险",
                        "isLeaf": 1,
                        "companyId": 34944,
                        "bgColor": "#FFF3F3",
                        "children": [],
                        "labelName": "严重行政处罚",
                        "labelCode": "4_1_",
                        "fontColor": "#FD5757"
                    },
                    {
                        "pcode": "2_2_3_",
                        "level": 4,
                        "linkBizId": 211,
                        "num": 1,
                        "orderNum": 30,
                        "remark": null,
                        "isLeaf": 1,
                        "companyId": 34944,
                        "bgColor": "#E4F3FD",
                        "children": [],
                        "labelName": "勘察综合甲级",
                        "labelCode": "2_2_3_1_",
                        "fontColor": "#41A1FD"
                    },
                    {
                        "pcode": "3_2_",
                        "level": 3,
                        "linkBizId": null,
                        "num": 1,
                        "orderNum": 67,
                        "remark": "高新技术企业指在国家颁布的《国家重点支持的高新技术领域》范围内，持续进行研究开发与技术成果转化，形成企业核心自主知识产权，并以此为基础开展经营活动的居民企业，是知识密集、技术密集的经济实体。",
                        "isLeaf": 1,
                        "companyId": 34944,
                        "bgColor": "#FFF7EC",
                        "children": [],
                        "labelName": "高新技术企业",
                        "labelCode": "3_2_1_",
                        "fontColor": "#BFA061"
                    },
                    {
                        "pcode": "3_1_1_1_",
                        "level": 5,
                        "linkBizId": null,
                        "num": 1,
                        "orderNum": 77,
                        "remark": null,
                        "isLeaf": 1,
                        "companyId": 34944,
                        "bgColor": "#FFF7EC",
                        "children": [],
                        "labelName": "国家优质工程奖",
                        "labelCode": "3_1_1_1_2_",
                        "fontColor": "#BFA061"
                    },
                    {
                        "pcode": "1_1_",
                        "level": 3,
                        "linkBizId": null,
                        "num": 1,
                        "orderNum": 113,
                        "remark": null,
                        "isLeaf": 1,
                        "companyId": 34944,
                        "bgColor": "#F3F3FF",
                        "children": [],
                        "labelName": "华东",
                        "labelCode": "1_1_5_",
                        "fontColor": "#8491E8"
                    }
                ],
                "companyId": null,
                "domicileCity": null,
                "liceIssueDate": "2021-08-26",
                "aptitudeCountNew": 13,
                "phone": "0791-88169855,0791-8169855,18637170411,52010202",
                "registrationType": null,
                "name": "核工业江西工程勘察研究总院有限公司",
                "filePlaceCode": null,
                "jskBidCount": 3,
                "isEMS": null,
                "aptitudeCount": 18,
                "liceValidityDate": "2026-08-26",
                "registeredCapitalStr": "10000",
                "attn": null,
                "isLocalC": null,
                "no": null,
                "other": null,
                "registeredDate": "1999-06-04",
                "city": null,
                "isCountryCredit": null,
                "zzZfcgsxCount": null,
                "nameSimple": null,
                "creditCode": "91360000705546361G",
                "badCreditChinaCount": null,
                "rate": null,
                "registeredCapital": 10000.0,
                "legalPerson": "罗辉",
                "zzJdcgsxCount": null,
                "domicileNum": null,
                "companyType": "4",
                "regionList": null,
                "rateTime": null,
                "businessStatus": "在业",
                "seriousIllegalCount": null,
                "url": null,
                "isLocal": null,
                "isOHSMS": null,
                "persionCount": 149,
                "regionId": null,
                "liceValidDay": 1246,
                "registeredPersonnelCount": 72,
                "domicile": "江西省-南昌市-南昌县",
                "jskEid": 34944,
                "numPunish": null,
                "customerCount": 376
            }
        ],
        "totalCount": 399552
    },
    "msg": "查询成功"
}

```
返回code码见 API 前置说明
