# 股东信息查询

**分类:** 工商信息
**路径:** `POST /v1/company/personnel/bestStockPage`
**Content-Type:** `application/json`

### 请求地址
/v1/company/personnel/bestStockPage

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| isHistory | Integer | - | 是 | 是否历史记录 1 是， 0 否 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "companyName":"中国华西工程设计建设有限公司",
  "isHistory":"1",
  "pageIndex":"1",
  "pageSize":"3"
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| conDate | String | 64 | 否 | 认缴出资日期 |
| stockPercent | Double | 40,10 | 否 | 股比 |
| stockName | String | 255 | 否 | 股东企业名称 |
| realCapi | String | 40,10 | 否 | 实缴金额 |
| stockId | Integer | - | 是 | 股东企业id |
| realCapiDate | String | 64 | 是 | 参股日期 |
| businessStatus | String | 255 | 否 | 股东企业经营状态 |
| shouldCapiConv | String | 40,10 | 否 | 认缴金额 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "msg": "查询成功",
    "data": {
        "totalCount": 30,
        "list": [
            {
                "conDate": "",
                "stockPercent": 0.02,
                "stockName": "沈际伦",
                "realCapi": null,
                "stockId": null,
                "realCapiDate": "",
                "businessStatus": "存续（在营、开业、在册）",
                "shouldCapiConv": "17.60万元人民币"
            },
            {
                "conDate": "",
                "stockPercent": 0.02,
                "stockName": "郭克城",
                "realCapi": null,
                "stockId": null,
                "realCapiDate": "",
                "businessStatus": "存续（在营、开业、在册）",
                "shouldCapiConv": "17.20万元人民币"
            },
            {
                "conDate": "",
                "stockPercent": 0.02,
                "stockName": "廖作铨",
                "realCapi": null,
                "stockId": null,
                "realCapiDate": "",
                "businessStatus": "存续（在营、开业、在册）",
                "shouldCapiConv": "17.20万元人民币"
            }
        ]
    }
}

```
