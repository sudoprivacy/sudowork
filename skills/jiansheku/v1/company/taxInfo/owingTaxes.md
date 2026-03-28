# 欠税信息

**分类:** 经营风险
**路径:** `POST /v1/company/taxInfo/owingTaxes`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/taxInfo/owingTaxes

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| uTags | Integer |  | 否 | 历史数据，参考值为 0 1 2 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  	"companyName": "海南第二建设工程有限公司",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| address | String | 500 | 否 | 所属市县区 |
| area | String | 1000 | 否 | 经营地点 |
| currOverdueAmount | Double | 0,0 | 否 | 当前发生的欠税余额 |
| operName | String | 255 | 否 | 负责人姓名 |
| overdueAmount | Double | 0,0 | 否 | 欠税余额 |
| overduePeriod | String | 1000 | 否 | 欠税所属期 |
| overdueType | String | 255 | 否 | 欠税税种 |
| pubDate | String | 20 | 否 | 发布日期 |
| pubDepartment | String | 1000 | 否 | 发布单位 |
| taxpayerNum | String | 255 | 否 | 纳税人识别号 |
| taxpayerType | String | 255 | 否 | 纳税人类型 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "address": "",
                "area": "海南老城经济开发区新兴路",
                "currOverdueAmount": "0.0",
                "operIdNum": "",
                "operName": "何焕广",
                "overdueAmount": "222.19",
                "overduePeriod": "",
                "overdueType": "城市维护建设税",
                "pubDate": "2021-04-09",
                "pubDepartment": "国家税务总局澄迈县税务局",
                "taxpayerNum": "9146902558393615X8",
                "taxpayerType": ""
            }
        ],
        "totalCount": 6
    },
    "msg": "查询成功"
}

```
