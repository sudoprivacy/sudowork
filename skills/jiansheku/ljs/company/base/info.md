# 企业基本信息 企业简介

**分类:** 工商信息
**路径:** `POST /ljs/company/base/info`
**Content-Type:** `application/json`

## **工商基本信息查询**

### **接口描述**
根据企业查询此企业工商基本信息。

### **字符编码**
UTF-8

### **请求地址**
/ljs/company/base/info
 

### **请求方式**
POST(application/json)

### **请求参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |


#### **请求示例**
{
​
  "companyName":"中建三局集团有限公司"
​
}

### **响应参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| addressDetail | String | 255 | 是 | 工商地址 |
| companyEconomicNature | String | 200 | 否 | 企业经济性质 |
| belongOrg | String | 255 | 是 | 登记机关 |
| businessDateFrom | String | 255 | 是 | 经营开始日期 yyyy-mm-dd |
| businessDateTo | String | 255 | 否 | 经营结束日期 yyyy-mm-dd |
| businessScope | String | 65535 | 否 | 经营范围 |
| checkDate | String | 255 | 是 | 核准日期 yyyy-mm-dd |
| cityId | Integer | - | 是 | 市id |
| cityName | String | 20 | 否 | 市名称 |
| companyName | String | 255 | 是 | 企业名称 |
| companyType | String | 255 | 是 | 企业类别 |
| contactPhone | String | 60 | 否 | 联系电话 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| districtCode | Integer | - | 是 | 区县id |
| districtName | String | 20 | 否 | 区县名称 |
| email | String | 100 | 否 | 企业邮箱 |
| endDate | String | 255 | 否 | 截止日期 yyyy-mm-dd |
| historyName | String | 65535 | 否 | 曾用名 json |
| id | Integer | - | 是 | 企业id |
| insuredNum | Integer | - | 是 | 参保人数 |
| introduction | String | 65535 | 是 | 企业简介 |
| nature | String | 255 | 是 | 企业性质 |
| operName | String | 255 | 是 | 法人 |
| postCode | String | 255 | 否 | 邮编、邮政编码 |
| province | String | 10 | 是 | 行政区名称 |
| provinceCode | String | 10 | 是 | 省份代码（新） |
| regCapCurrency | String | 10 | 否 | 货币类型 |
| regCapital | String | 255 | 是 | 注册资本 |
| regUnit | String | 255 | 否 | 货币单位 |
| startDate | String | 255 | 否 | 注册日期 yyyy-mm-dd |
| status | String | 50 | 是 | 经营状态：(枚举:在业、清算、迁入、迁出、停业、撤销、吊销、注销、不详) |
| recordStatus | String | 50 | 是 | 登记状态：存续（在营、开业、在册） |
| taxLvl | String | 1 | 否 | 税务等级 1 ：A级 |
| url | String | 255 | 否 | 工商快照信息url |
| companyCategory | String | 255 | 否 | 企业类型 |
| website | String | 200 | 否 | 网址 |
| logoUrl | String | 255 | 否 | logo链接地址 |
| actualCapi | String | 255 | 否 | 实缴金额 |


#### **返回结果示例**
{
  "code": 200,
  "msg": "请求成功",
  "data": {
    "orgCode": "757013137",
    "districtCode": 420100,
    "cityId": 420100,
    "districtName": "武汉市",
    "cityName": "武汉市",
    "taxLvl": "1",
    "historyName": null,
    "companyName": "中建三局集团有限公司",
    "creditCode": "91420000757013137P",
    "id": 3068,
    "url": "",
    "eid": "5f22a318-68f5-4449-85cb-749cfc4578cc",
    "addressDetail": "武汉市关山路552号",
    "postCode": "",
    "province": "湖北省",
    "provinceCode": "420000",
    "endDate": "",
    "companyType": "有限责任公司（非自然人投资或控股的法人独资）",
    "businessDateTo": "",
    "checkDate": "2022-06-14",
    "businessDateFrom": "2003-12-29",
    "regCapital": "1500000",
    "actualCapi": "1350000",
    "regCapCurrency": "CNY",
    "regUnit": "万元",
    "businessScope": "各类建筑工程总承包、施工、咨询、建筑技术开发与转让、机械设备租赁、路桥建设，建筑工程、人防工程设计，商品混凝土的生产和批发；园林绿化工程；爆破作业设计施工（四级，有效期至2022年8月21日）；建筑材料（设备）销售；机电设备销售；污水处理设备销售及环保设备销售。",
    "belongOrg": "湖北省市场监督管理局",
    "operName": "陈卫国",
    "startDate": "2003-12-29",
    "status": "在业",
    "recordStatus": "存续（在营、开业、在册）",
    "introduction": "中建三局集团有限公司成立于2003-12-29，法定代表人为陈卫国，注册资本为1500000万元，统一社会信用代码为91420000757013137P，企业地址位于武汉市关山路552号，经营范围包含各类建筑工程总承包、施工、咨询、建筑技术开发与转让、机械设备租赁、路桥建设，建筑工程、人防工程设计，商品混凝土的生产和批发；园林绿化工程；爆破作业设计施工（四级，有效期至2022年8月21日）；建筑材料（设备）销售；机电设备销售；污水处理设备销售及环保设备销售。。中建三局集团有限公司目前的经营状态为在业。",
    "email": "zjsj@cscec.com",
    "contactPhone": "027-65276668",
    "website": "cscec3b.com",
    "insuredNum": 13369,
   "logoUrl": "https://qxb-logo-url.oss-cn-hangzhou.aliyuncs.com/OriginalUrl/4011757c89fafc3497f27868a3614005.jpg",
    "nature": "有限责任公司（非自然人投资或控股的法人独资）",
    "companyCategory": "有限责任公司",
    "companyEconomicNature": "央企子公司,国有企业"
  }
}
返回code码见 API 前置说明
