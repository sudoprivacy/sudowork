# 土地交易详情

**分类:** 商机线索
**路径:** `POST /v1/company/results/tdjyInfo`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/tdjyInfo

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Long | 20 | 是 | 土地交易详情id |


#### 请求示例

```
{
  "id": "9974335"
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | Long | 20 | 是 | 详情id |
| projectName | String | 255 | 是 | 项目名称 |
| company | String | 255 | 是 | 受让人 |
| companyId | Integer | - | 否 | 企业ID |
| acreage | String | 255 | 否 | 出让面积 |
| addMoneyRange | String | 32 | 是 | 加价幅度 |
| auctionBeginTime | Date | - | 否 | 招拍挂起始时间 |
| auctionEndTime | Date | - | 否 | 招拍挂截止时间 |
| authority | String | 255 | 是 | 批准单位 |
| bondmoney | String | 255 | 否 | 保证金 |
| buildArea | String | 255 | 是 | 建筑面积 |
| buildingDensity | String | 64 | 是 | 建筑密度 |
| buildingHeight | String | 64 | 是 | 建筑限高 |
| province | String | 16 | 是 | 省 |
| provinceId | Integer | - | 否 | 省id |
| city | String | 16 | 是 | 市 |
| cityId | Integer | - | 否 | 市id |
| area | String | 16 | 是 | 区 |
| areaId | Integer | - | 否 | 区id |
| contractNum | String | 255 | 是 | 合同编号 |
| contractSignTime | Date | - | 否 | 合同签订日期 |
| conventionBeginTime | Date | - | 否 | 约定开工日期 |
| conventionEndTime | Date | - | 否 | 约定竣工日期 |
| conventionLandTime | Date | - | 否 | 约定交地日期 |
| conventionVolumeRate | String | 128 | 是 | 约定容积率 |
| detailUrl | String | 255 | 是 | 结果详情url |
| electronicNumber | String | 32 | 是 | 电子监管号 |
| gdgid | String | 64 | 是 |  |
| greeningRate | String | 64 | 是 | 绿化率 |
| industry | String | 64 | 是 | 行业分类 |
| investmentIntensity | String | 64 | 是 | 投资强度 |
| joinBeginTime | Date | - | 否 | 报名起始时间 |
| joinEndTime | Date | - | 否 | 报名截止时间 |
| landAddr | String | 255 | 是 | 土地坐落 |
| landLevel | String | 32 | 是 | 土地级别 |
| landName | String | 255 | 是 | 地块名称 |
| landNoticeUrl | String | 255 | 是 | 地块公示url |
| landSource | String | 255 | 是 | 土地来源 |
| landUse | String | 32 | 是 | 土地用途 |
| landUseCompany | String | 255 | 是 | 土地使用权人 |
| landUseCompanyId | Integer | - | 否 | 土地使用权人企业ID |
| landUseYear | String | 255 | 是 | 出让年限 |
| moneyBegin | String | 16 | 是 | 起始价 |
| paymentAgreement | String | 255 | 是 | 分期支付约定 |
| realBeginTime | Date | - | 否 | 实际开工日期 |
| realEndTime | Date | - | 否 | 实际竣工日期 |
| sellNoticeUrl | String | 255 | 是 | 出让公告url |
| supplyLandWay | String | 16 | 是 | 供地方式/供应方式 |
| transactionPrice | String | 16 | 是 | 成交价格 |
| transactionPublicityTime | String | 64 | 是 | 成交公示日期 |
| volumeRate | String | 30 | 是 | 容积率 |
| volumeRateHigh | String | 255 | 是 | 约定容积率上限 |
| volumeRateLow | String | 255 | 是 | 约定容积率下限 |
| dataSource | String | 255 | 是 | 来源地址 |


 

#### 返回结果示例

```
{
  "code": 200,
  "msg": "请求成功",
  "data": {
    "id": 9974335,
    "projectName": "新兴县新成工业园.北园市政建设工程",
    "company": "新兴县新成工业园开发有限公司",
    "companyId": 156410935,
    "acreage": "13067.2",
    "addMoneyRange": "",
    "auctionBeginTime": null,
    "auctionEndTime": null,
    "authority": "新兴县人民政府",
    "bondmoney": "0.0",
    "buildArea": "0.0",
    "buildingDensity": "",
    "buildingHeight": "",
    "province": "广东省",
    "provinceId": 440000,
    "city": "云浮市",
    "cityId": 445300,
    "area": "新兴县",
    "areaId": 445321,
    "contractNum": "4453212022029",
    "contractSignTime": 1666886400000,
    "conventionBeginTime": null,
    "conventionEndTime": null,
    "conventionLandTime": null,
    "conventionVolumeRate": "",
    "detailUrl": "https://landchina.com/#/landSupplyDetail?id=720b7f5c-798c-48ae-8a2f-2d9381edadfc&type=%E4%BE%9B%E5%9C%B0%E7%BB%93%E6%9E%9C&path=0",
    "electronicNumber": "4453212022A00318",
    "gdgid": "720b7f5c-798c-48ae-8a2f-2d9381edadfc",
    "greeningRate": "",
    "industry": "交通运输、仓储和邮政业",
    "investmentIntensity": "0.0",
    "joinBeginTime": null,
    "joinEndTime": null,
    "landAddr": "新兴县新成工业园.北园",
    "landLevel": "四级",
    "landName": "445321002002GB00007",
    "landNoticeUrl": "",
    "landSource": "新增",
    "landUse": "城镇村道路用地",
    "landUseCompany": "新兴县新成工业园开发有限公司",
    "landUseCompanyId": 156410935,
    "landUseYear": "",
    "moneyBegin": "0",
    "paymentAgreement": "",
    "zfQh": null,
    "zfSj": null,
    "zfJe": null,
    "bz": null,
    "realBeginTime": null,
    "realEndTime": null,
    "sellNoticeUrl": "",
    "supplyLandWay": "划拨供地",
    "transactionPrice": "0",
    "transactionPublicityTime": "",
    "volumeRate": "",
    "volumeRateHigh": null,
    "volumeRateLow": null,
    "dataSource": "中国土地市场网",
    "isEnable": 1,
    "createTime": 1666861722000,
    "updateTime": 1666861722000
  }
}

```
