# 土地交易列表

**分类:** 商机线索
**路径:** `POST /v1/company/results/tdjyList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/tdjyList

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | String | - | 是 | 分页对象 Json对象 |
| page | Integer | - | 是 | 页数 |
| limit | Integer | - | 是 | 条数 |
| landMarketDto | String | - | 否 | 土地查询对象 Json |
| area | String | 255 | 否 | 区- 多个逗号,隔开 |
| province | String | 255 | 否 | 省- 多个逗号,隔开 |
| city | String | 255 | 否 | 市- 多个逗号,隔开 |
| companyName | String | 255 | 否 | 受让人 |
| contractSignTimeStart | Date | - | 否 | 合同签订日期起 |
| contractSignTimeEnd | Date | - | 否 | 合同签订日期止 |
| startAcreage | String | 255 | 否 | 出让面积起 |
| endAcreage | String | 255 | 否 | 出让面积止 |
| startTransactionPrice | Double | 16,2 | 否 | 成交价格-起 (单位是万元) |
| endTransactionPrice | Double | 16,2 | 否 | 成交价格-止 (单位是万元) |
| industry | String | 255 | 否 | 行业分类 多个逗号,隔开 |
| keyword | String | 255 | 否 | 关键字搜索(如项目名称) |
| landAddr | String | 255 | 否 | 土地坐落 多个空格隔开 |
| landUse | String | 32 | 否 | 土地用途 多个逗号,隔开 |
| supplyLandWay | String | 16 | 否 | 供地方式/供应方式 多个逗号,隔开 |
| volumeRateHigh | Double | 16,2 | 否 | 约定容积率上限 |
| volumeRateLow | Double | 16,2 | 否 | 约定容积率下限 |


#### 请求示例

```
{
  "page": {
    "page": 1,
    "limit": 20
  },
  "landMarketDto": {
    "landUse": "城镇村道路用地",
    "province": "",
    "city": "",
    "area": "445321",
    "supplyLandWay": "划拨供地",
    "industry": "交通运输、仓储和邮政业"
  }
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| contractSignTime | String | 10 | 否 | 合同签订日期 |
| supplyLandWay | String | 16 | 是 | 供地方式/供应方式 |
| companyId | Integer | - | 否 | 企业ID |
| companyName | String | 255 | 是 | 受让人 |
| transactionPrice | Double | 16,2 | 是 | 成交价格 |
| acreage | Double | 16,2 | 否 | 出让面积 |
| domicile | String | 255 | 否 | 行政区划 |
| industry | String | 64 | 是 | 行业分类 |
| id | Integer | - | 是 | 土地交易详情id |
| projectName | String | 255 | 是 | 项目名称 |
| landAddr | String | 255 | 是 | 土地坐落 |
| landUse | String | 32 | 是 | 土地用途 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 24,
    "list": [
      {
        "contractSignTime": "2020-09-15",
        "supplyLandWay": "划拨供地",
        "companyId": 158941019,
        "companyName": "新兴县城市管理局",
        "transactionPrice": 0,
        "acreage": 5446,
        "domicile": "广东省云浮市新兴县",
        "industry": "交通运输、仓储和邮政业",
        "id": 8257248,
        "projectName": "新城镇东堤南路东侧20米道路项目",
        "landAddr": "新城镇东堤南路东侧",
        "landUse": "城镇村道路用地"
      },
      {
        "contractSignTime": "2020-09-15",
        "supplyLandWay": "划拨供地",
        "companyId": 158941019,
        "companyName": "新兴县城市管理局",
        "transactionPrice": 0,
        "acreage": 13482,
        "domicile": "广东省云浮市新兴县",
        "industry": "交通运输、仓储和邮政业",
        "id": 5994546,
        "projectName": "新城镇文兴路项目",
        "landAddr": "新城镇文兴路",
        "landUse": "城镇村道路用地"
      }
    ]
  }
}

```
