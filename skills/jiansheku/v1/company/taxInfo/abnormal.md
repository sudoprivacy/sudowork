# 非正常户

**分类:** 经营风险
**路径:** `POST /v1/company/taxInfo/abnormal`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/taxInfo/abnormal

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
  	"companyName": "广州惠琳国际贸易有限公司",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| area | String | 255 | 否 | 生产经营地址 |
| judgeArea | String | 255 | 否 | 认定单位的地址 |
| judgeDate | String | 255 | 否 | 认定日期 |
| judgeDepartment | String | 255 | 否 | 认定单位 |
| judgePhone | String | 255 | 否 | 认定单位电话 |
| name | String | 255 | 否 | 企业名称 |
| overdueAmount | String | 255 | 否 | 欠税金额 |
| overdueType | String | 255 | 否 | 欠税税务种类 |
| pubDate | String | 255 | 否 | 公告日期 |
| reason | String | 255 | 否 | 认定原因 |
| status | String | 255 | 否 | 纳税人状态 |
| taxNum | String | 255 | 否 | 纳税人识别号 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "area": "广州市海珠区新港中路艺影街11号1806房（仅限办公用途）",
                "judgeDepartment": "国家税务总局广州市海珠区税务局",
                "reason": "",
                "overdueAmount": "",
                "judgeDate": "",
                "judgeArea": "",
                "name": "广州惠琳国际贸易有限公司",
                "taxNum": "91440101MA5AY0FN4Y",
                "overdueType": "",
                "pubDate": "2021-10-08",
                "judgePhone": "",
                "status": ""
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
