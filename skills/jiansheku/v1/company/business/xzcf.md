# 行政处罚

**分类:** 经营风险
**路径:** `POST /v1/company/business/xzcf`
**Content-Type:** `application/json`

### 请求地址
/v1/company/business/xzcf

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
| startTime | String | 255 | 否 | 筛选时间值 |
| type | Integer | - | 是 | 处罚类别：0.交易处罚；1.环保处罚；2.安全事故；3.拖欠农民工工资；4.其他行政处罚 |


#### 请求示例

```
{
"companyName":"四川麦秀装饰工程有限公司",
"type":"4",
"startTime":"2019-06-03",
"pageIndex":"1",
"pageSize":"2"
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| companyName | String | 255 | 是 | 企业名称 |
| projectName | String | 255 | 是 | 相关项目 |
| punishBegin | String | 20 | 是 | 处罚开始时间 |
| punishEnd | String | 20 | 否 | 处罚结束时间 |
| punishLevel | Integer | - | 是 | 处罚级别（0:省级，1:市级，2:区县级，3:全国） |
| punishOffice | String | 255 | 否 | 处罚机关 |
| punishReason | String | 65535 | 否 | 违法内容 |
| punishResult | String | 65535 | 否 | 处罚结果 |
| url | String | 255 | 否 | 数据来源 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "companyName": "四川麦秀装饰工程有限公司",
                "projectName": "",
                "punishBegin": "2019-06-05",
                "punishEnd": "",
                "punishLevel": 2,
                "punishLevelStr": "区县级",
                "punishOffice": "成都市武侯区市场和监督管理局",
                "punishReason": "成都市合茂装饰工程有限公司等4461户公司违反相关规定，经调查，在成都市武侯区行政审批局登记的4461户公司及其分支机构长期停产停业未向成都市武侯区行政审批局申报注销企业营业执照。",
                "punishResult": "都维罗娜暖通设备有限公司等3870户公司及其分支机构长期停产停业",
                "url": ""
            },
            {
                "companyName": "四川麦秀装饰工程有限公司",
                "projectName": "",
                "punishBegin": "2019-06-05",
                "punishEnd": "2099-12-31",
                "punishLevel": 2,
                "punishLevelStr": "区县级",
                "punishOffice": "成都市武侯区市场和监督管理局",
                "punishReason": "违反登记管理行为>>公司及其分支机构违法行为>>公司成立后无正当理由超过6个月未开业的,或者开业后自行停业连续6个月以上",
                "punishResult": "已吊销",
                "url": ""
            }
        ],
        "totalCount": 2
    },
    "msg": "查询成功"
}

```
