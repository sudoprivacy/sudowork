# 股权出质

**分类:** 债务风险
**路径:** `POST /v1/company/industrial/equityQuality`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/equityQuality

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
  	"companyName": "上海喜马拉雅科技有限公司",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| date | String | 255 | 否 | 股权出质设立登记日期 |
| number | String | 255 | 否 | 登记编号 |
| pawnee | String | 255 | 否 | 质权人 |
| pawneeIdentifyNo | String | 255 | 否 | 质权企业证照号 |
| pledgor | String | 255 | 否 | 出质人 |
| pledgorAmount | String | 255 | 否 | 出质股权数额 |
| pledgorCurrency | String | 255 | 否 | 出质股权数额币种 |
| pledgorIdentifyNo | String | 255 | 否 | 出质企业证照号 |
| pledgorUnit | String | 255 | 否 | 出质股权数额单位 |
| publicDate | String | 255 | 否 | 公示日期 |
| status | String | 255 | 否 | 状态 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "pawneeIdentifyNo": "",
                "date": "2016-06-03",
                "number": "1220160069",
                "pledgorCurrency": "XXX",
                "pledgorIdentifyNo": "",
                "pawnee": "上海歌斐资产管理有限公司",
                "pledgorAmount": "742.1446",
                "pledgorUnit": "",
                "publicDate": "2016-06-03",
                "pledgor": "上海证大投资发展股份有限公司",
                "status": "无效"
            }
        ],
        "totalCount": 30
    },
    "msg": "查询成功"
}

```
