# 企业工商年报

**分类:** 工商信息
**路径:** `POST /v1/company/industrial/report`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/report

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |
| year | String | 255 | 是 | 年份 |


#### 请求示例

```
{
  	"companyName": "中建三局集团有限公司",
        "year":2021
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| address | String | 255 | 否 | 地址 |
| colleguesNum | String | 255 | 否 | 从业人数 |
| creditNo | String | 255 | 否 | 企业统一社会信用代码 |
| debitAmount | String | 255 | 否 | 负债总额 |
| email | String | 255 | 否 | 企业电子邮箱 |
| enterpriseHoldingSituation | String | 255 | 否 | 企业控股情况 |
| fareScope | String | 255 | 否 | 主营业务 |
| fax | String | 255 | 否 | 传真 |
| femaleColleguesNum | String | 255 | 否 | 其中女性从业人数 |
| guaranteeItems | String | 255 | 否 | 年报担保信息 |
| ifEquity | String | 255 | 否 | 是否发生股东股权转让 |
| ifExternalGuarantee | String | 255 | 否 | 是否提供对外担保 |
| ifWebsite | String | 255 | 否 | 有无网站、网店 |
| investItems | String | 255 | 否 | 年报投资信息 |
| name | String | 255 | 否 | 企业名称 |
| netAmount | String | 255 | 否 | 净利润 |
| operName | String | 255 | 否 | 法定代表人 |
| partners | String | 255 | 否 | 年报股东信息 |
| pracPersonNum | String | 255 | 否 | 实际员工数量 |
| profitReta | String | 255 | 否 | 所有者权益合计 |
| profitTotal | String | 255 | 否 | 利润总额 |
| regCapi | String | 255 | 否 | 注册资本 |
| regNo | String | 255 | 否 | 注册号 |
| reportDate | String | 255 | 否 | 年报日期 |
| reportName | String | 255 | 否 | 年报名称 |
| reportYear | String | 255 | 否 | 年报年份 |
| saleIncome | String | 255 | 否 | 销售总额 |
| servFareIncome | String | 255 | 否 | 主营业务收入 |
| status | String | 255 | 否 | 企业经营状态 |
| stockChanges | String | 255 | 否 | 年报股东变更 |
| taxTotal | String | 255 | 否 | 纳税总额 |
| telephone | String | 255 | 否 | 企业电话 |
| totalEquity | String | 255 | 否 | 资产总额 |
| websites | String | 255 | 否 | 年报网站信息 |
| zipCode | String | 255 | 否 | 邮编 |
| ifInvest | String | 255 | 否 | 企业是否有投资信息或购买其他企业股权 |


#### 返回结果示例

```
{
    "code": 200,
    "data": [
        {
            "address": "武汉市关山路552号",
            "colleguesNum": "14226人",
            "creditNo": "91420000757013137P",
            "debitAmount": "14970729.08万元",
            "email": "zjsj@cscec.com",
            "enterpriseHoldingSituation": "",
            "fareScope": "各类建筑工程总承包、施工、咨询、建筑技术开发与转让、机械设备租赁、路桥建设，建筑工程、人防工程设计，商品混凝土的生产和批发；园林绿化工程；爆破作业设计施工（四级，有效期至2022年8月21日），建筑材料（设备）销售、机电设备销售、污水处理设备销售及环保设备销售（涉及许可经营项目，应取得相关部门许可后方可经营）",
            "fax": "",
            "femaleColleguesNum": "1905",
            "guaranteeItems": "[]",
            "ifEquity": "否",
            "ifExternalGuarantee": "否",
            "ifInvest": "否",
            "ifWebsite": "否",
            "investItems": "[{\"seq_no\": 1, \"invest_name\": \"襄阳市环线提速改造建设运营有限公司\", \"invest_reg_no\": \"91420600MA49EKNT7U\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"3f7dc820-e698-4087-832e-6e8a737de8c9\"}, {\"seq_no\": 2, \"invest_name\": \"福建省闽信环境发展有限公司\", \"invest_reg_no\": \"91350600MA2XQC1M1L\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"4024a1c3-5c24-4c8e-ac56-559282543988\"}, {\"seq_no\": 3, \"invest_name\": \"衡水中建哈院项目管理有限公司\", \"invest_reg_no\": \"91131102MA0A4KYA0Y\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"a29d6feb-ba8f-4131-b84d-2ef4b5901056\"}, {\"seq_no\": 4, \"invest_name\": \"武汉滨江基础设施建设发展有限公司\", \"invest_reg_no\": \"91420100MA4KTRKF4E\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"9642778a-1047-4dc3-9711-716a588dc0d9\"}, {\"seq_no\": 5, \"invest_name\": \"武汉千子山能源有限公司\", \"invest_reg_no\": \"91420114MA49FTQ5XF\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"63ff5a38-5bd6-4453-a959-cc36604ae42b\"}, {\"seq_no\": 6, \"invest_name\": \"中建三局襄阳鱼梁洲生态建设运营有限公司\", \"invest_reg_no\": \"91420600MA498YD79C\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"45a7718b-b0a2-4795-8c43-9d9c110c2c3b\"}, {\"seq_no\": 7, \"invest_name\": \"乌鲁木齐中城丝路体育管理有限公司\", \"invest_reg_no\": \"91650109MA77QY7EXT\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"7071dbb2-956f-49ea-84fb-d893bf3b6189\"}, {\"seq_no\": 8, \"invest_name\": \"中建未来城市（新疆）投资有限公司\", \"invest_reg_no\": \"91650100MA77HNCX8K\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"ed709cec-bca5-4cb0-921c-2060e83f17e5\"}, {\"seq_no\": 9, \"invest_name\": \"成都海悦建设有限公司\", \"invest_reg_no\": \"91510100MA61UNAB99\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"ccb9ffbd-a820-4018-875c-87666db13e83\"}, {\"seq_no\": 10, \"invest_name\": \"武汉市建鑫市政管廊建设运营有限公司\", \"invest_reg_no\": \"91420112MA49CW3W63\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"1f463b3c-6689-402f-ad6e-9479730948af\"}, {\"seq_no\": 11, \"invest_name\": \"贵州中建秀印高速公路有限公司\", \"invest_reg_no\": \"91520600MA6DNRK65N\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"bbd69aa9-abfd-47d0-afb4-0b87ef759493\"}, {\"seq_no\": 12, \"invest_name\": \"枝江市建信市政工程建设有限公司\", \"invest_reg_no\": \"91420583MA49786J62\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"b2b4d521-50c4-4d76-b34a-c895a767f559\"}, {\"seq_no\": 13, \"invest_name\": \"北京中建共赢三号基础设施投资中心（有限合伙）\", \"invest_reg_no\": \"91110108MA00DWF351\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"4efacd3b-75e8-4805-8b5a-e80e0fdd0a42\"}, {\"seq_no\": 14, \"invest_name\": \"西安楚信投资建设有限公司\", \"invest_reg_no\": \"91610111MA6WUHGT6P\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"22c63b07-3a4a-45b1-81af-08db5c8f3e29\"}, {\"seq_no\": 15, \"invest_name\": \"中建西安浐灞生态区建设投资有限公司\", \"invest_reg_no\": \"91610136MA6WYUK015\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"ffd72068-2b0d-4c96-92d7-451ddb1a9090\"}, {\"seq_no\": 16, \"invest_name\": \"中建三局湖北大东湖深隧工程建设运营有限公司\", \"invest_reg_no\": \"91420000MA49268002\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"f09c53e2-f702-4983-8ef8-b8468d080f36\"}, {\"seq_no\": 17, \"invest_name\": \"中建（武汉光谷）建设有限公司\", \"invest_reg_no\": \"91420100MA4KMDFDXM\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"de2ea1f9-a493-47f7-a003-32c7b9be38ff\"}, {\"seq_no\": 18, \"invest_name\": \"云南机场建设发展有限公司\", \"invest_reg_no\": \"91530000216563275J\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"af190061-0a2a-4d27-93ef-e9bf70666746\"}, {\"seq_no\": 19, \"invest_name\": \"中建武汉杨泗港路桥建设运营有限公司\", \"invest_reg_no\": \"91420106MA4KWW194X\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"578c676e-eab9-4e2b-8a74-893ea946b69d\"}, {\"seq_no\": 20, \"invest_name\": \"武汉中建三局鸿城地产开发有限公司\", \"invest_reg_no\": \"91420115055706035W\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"c526e1e2-699b-44d1-89f7-abc19a5f784b\"}, {\"seq_no\": 21, \"invest_name\": \"武汉市武阳高速公路投资管理有限公司\", \"invest_reg_no\": \"91420100MA4KXW5T9N\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"d3927da8-9b48-4230-8693-694db3721278\"}, {\"seq_no\": 22, \"invest_name\": \"荆门中建二零七公路建设有限公司\", \"invest_reg_no\": \"91420800MA492P7H5H\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"59e862f2-ddcb-4ca7-817d-c03f376b2699\"}, {\"seq_no\": 23, \"invest_name\": \"湖北楚江南置业有限公司\", \"invest_reg_no\": \"91421124316521339X\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"7926875e-6422-46fa-adce-c74983de631f\"}, {\"seq_no\": 24, \"invest_name\": \"中建京北投资发展有限公司\", \"invest_reg_no\": \"91110229MA009PXW6W\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"aaa0ccc8-cc9e-45a6-ba9c-ce1a79f84695\"}, {\"seq_no\": 25, \"invest_name\": \"中建武汉黄孝河机场河水环境综合治理建设运营有限公司\", \"invest_reg_no\": \"91420102MA4K413J1J\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"62ea9fbd-76b4-409c-9da4-9cb49bc2ca4e\"}, {\"seq_no\": 26, \"invest_name\": \"中建西安城市发展有限公司\", \"invest_reg_no\": \"91610112MA6TXEB96W\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"4a7ce4f4-233d-44e4-8e22-0232fc742f40\"}, {\"seq_no\": 27, \"invest_name\": \"深圳启华基础设施建设投资合伙企业（有限合伙）\", \"invest_reg_no\": \"91440300MA5ETJKP0K\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"6ed1d98e-73af-413a-bf01-8c8ce649e9de\"}, {\"seq_no\": 28, \"invest_name\": \"贵州建信水务环境产业有限公司\", \"invest_reg_no\": \"91520100MA6DJUJW8N\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"03465fbb-46f8-425b-aa69-02b71dc084a2\"}, {\"seq_no\": 29, \"invest_name\": \"中建三局黄冈城市管廊建设运营有限公司\", \"invest_reg_no\": \"91421100MA497L42XL\", \"invest_capi\": \"\", \"invest_percent\": \"\", \"eid\": \"6a0bcdcf-6d49-42c2-902f-018e6f105cbb\"}]",
            "name": "中建三局集团有限公司",
            "netAmount": "733800.85万元",
            "operName": "",
            "partners": "[{\"seq_no\": 1, \"ex_id\": \"1029616430\", \"eid\": \"bc0c13ca-28fb-4867-9e23-a4852cc5f9e7\", \"category\": \"\", \"stock_name\": \"中国建筑第三工程局有限公司\", \"stock_type\": \"\", \"stock_percent\": \"\", \"identify_type\": \"\", \"identify_no\": \"\", \"total_should_capi\": \"1350000万元人民币\", \"total_real_capi\": \"1350000万元人民币\", \"should_capi_items\": [{\"shoud_capi\": \"1350000万元人民币\", \"should_capi_date\": \"2021-12-30\", \"invest_type\": \"货币\"}], \"real_capi_items\": [{\"real_capi\": \"1350000万元人民币\", \"real_capi_date\": \"2021-12-30\", \"invest_type\": \"货币\"}]}]",
            "pracPersonNum": "",
            "profitReta": "5149862.51万元",
            "profitTotal": "834421.81万元",
            "regCapi": "",
            "regNo": "420000400000435",
            "reportDate": "2022-05-30",
            "reportName": "2021年度报告",
            "reportYear": "2021",
            "saleIncome": "27033211.23万元",
            "servFareIncome": "27003088.04万元",
            "status": "开业",
            "stockChanges": "[]",
            "taxTotal": "412145.04万元",
            "telephone": "027-65276668",
            "totalEquity": "20120591.59万元",
            "websites": "[]",
            "zipCode": "430000"
        }
    ],
    "msg": "操作成功"
}

```
