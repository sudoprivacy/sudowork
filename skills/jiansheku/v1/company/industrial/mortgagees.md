# 动产抵押

**分类:** 债务风险
**路径:** `POST /v1/company/industrial/mortgagees`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/mortgagees

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


#### 请求示例

```
{
  	"companyName": "启东市申力高压油泵厂",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| status | String | 255 | 否 | 状态 |
| date | String | 255 | 否 | 登记日期 |
| number | String | 255 | 否 | 登记编号 |
| department | String | 255 | 否 | 登记机关 |
| type | String | 255 | 否 | 被担保债权种类 |
| amount | String | 255 | 否 | 被担保债权数额 |
| period | String | 255 | 否 | 债务人履行债务的期限 |
| scope | String | 2000 | 是 | 担保范围 |
| publicDate | String | 255 | 否 | 公示日期 |
| mortgagees | String | 65535 | 否 | 抵押权人 |
| guarantees | String | 65535 | 否 | 抵押物信息集合 |
| changeInfo | String | 65535 | 否 | 变更信息 |
| periodStart | String | 255 | 否 | 抵押起始时间 |
| periodEnd | String | 255 | 否 | 抵押结束时间 |
| dywqk | String | 65535 | 否 | 抵押物情况 |
| belongTo | String | 255 | 否 | 所有权或者使用权归属 |
| name | String | 255 | 否 | 抵押物 |
| desc | String | 255 | 否 | 抵押物状况 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "amount": "60万人民币",
                "bddy": "启东市农村信用合作联社惠丰信用社",
                "changeInfo": "",
                "date": "2008-05-04",
                "department": "南通市启东工商行政管理局",
                "dywqk": [
                    {
                        "belongTo": "自有产权",
                        "desc": "1台，Y3150,成新率30%，抵押物价值5.578万元，生产厂家上海第一机床厂，使用中，存放于公司内",
                        "name": "滚齿机"
                    },
                    {
                        "belongTo": "自有产权",
                        "desc": "1套，成新率30%，抵押物价值3.75万元，使用中，存放于公司内",
                        "name": "配变电设备"
                    },
                    {
                        "belongTo": "自有产权",
                        "desc": "2台，CD6140A-1000,成新率62%，抵押物价值7.906万元，使用中，存放于公司内",
                        "name": "普通车床"
                    },
                    {
                        "belongTo": "自有产权",
                        "desc": "价值212.952万元，使用中，存放于公司内",
                        "name": "其他"
                    }
                ],
                "guarantees": "[{\"seq_no\":1,\"belong_to\":\"自有产权\",\"name\":\"滚齿机\",\"desc\":\"1台，Y3150,成新率30%，抵押物价值5.578万元，生产厂家上海第一机床厂，使用中，存放于公司内\",\"remarks\":\"\"},{\"seq_no\":2,\"belong_to\":\"自有产权\",\"name\":\"配变电设备\",\"desc\":\"1套，成新率30%，抵押物价值3.75万元，使用中，存放于公司内\",\"remarks\":\"\"},{\"seq_no\":3,\"belong_to\":\"自有产权\",\"name\":\"普通车床\",\"desc\":\"2台，CD6140A-1000,成新率62%，抵押物价值7.906万元，使用中，存放于公司内\",\"remarks\":\"\"},{\"seq_no\":4,\"belong_to\":\"自有产权\",\"name\":\"其他\",\"desc\":\"价值212.952万元，使用中，存放于公司内\",\"remarks\":\"\"}]",
                "mortgagees": "[{\"name\": \"启东市农村信用合作联社惠丰信用社\", \"identify_no\": \"320681000008253\", \"identify_type\": \"营业执照\", \"seq_no\": 1, \"eid\": \"274e9ac0-3c70-4166-a638-99e146bf8fbe\", \"type\": 0}]",
                "number": "苏F5-0-2008-0008",
                "period": "自2012-03-07至2014-03-06",
                "periodEnd": "2014-03-06",
                "periodStart": "2012-03-07",
                "publicDate": "",
                "scope": "主债权,违约金,实现抵押权的费用,利息,损害赔偿金,合同中的其他约定",
                "status": "有效",
                "type": ""
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
