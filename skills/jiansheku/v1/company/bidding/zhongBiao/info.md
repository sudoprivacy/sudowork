# 中标业绩详情查询

**分类:** 中标业绩
**路径:** `POST /v1/company/bidding/zhongBiao/info`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/bidding/zhongBiao/info

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| projectId | String | 50 | 是 | 项目详情id |


#### 请求示例

```
{
  "projectId":1
}

```

### 响应参数
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| agency | String | 255 | 否 | 招标代理机构 |
| province | String | 20 | 否 | 项目所在省 |
| tradeType | String | 80 | 否 | 交易类型 |
| subjectMatterType | String | 80 | 否 | 标的物类型 |
| staffName | String | 255 | 否 | 项目经理 |
| boundType | String | 200 | 否 | 业绩类型 |
| projectUnit | String | 255 | 否 | 建设单位 |
| projectUnitId | Integer | - | 否 | 建设单位id |
| projectTypeNew | String | 80 | 否 | 建筑工程项目类型 |
| projectNature | String | 80 | 否 | 建设性质 |
| infoType | String | 20 | 否 | 信息类型 |
| district | String | 20 | 否 | 项目所在区县 |
| city | String | 20 | 否 | 项目所在市 |
| cityId | Integer | - | 否 | 项目所在市id |
| businessType | String | 80 | 否 | 业务类型 |
| addr | String | 20 | 否 | 中标地址 |
| bidNo | String | 100 | 否 | 中标项目编号 |
| companyName | String | 255 | 否 | 中标企业名称 |
| companyId | Integer | 11 | 是 | 中标企业id |
| contentId | Integer | - | 否 | 正文ID |
| districtId | Integer | - | 否 | 项目所在区县id |
| lowerRate | Double | 12,6 | 否 | 下浮率% |
| otherSource | String | 1500 | 否 | 其他来源 |
| period | Integer | - | 否 | 工期（天） |
| projectId | String | 11 | 否 | 项目详情id |
| projectName | String | 350 | 否 | 工程全称 |
| provinceId | Integer | - | 否 | 项目所在省id |
| registerNo | String | 20 | 否 | 执业印章号 |
| sourceName | String | 50 | 否 | 来源名称 |
| sourceUrl | String | 500 | 否 | 来源路径 |
| staffId | String | 32 | 否 | 人员ID |
| winBidAmount | Double | 16,6 | 否 | 中标金额（万元） |
| winBidTime | String | 20 | 否 | 中标时间 |


 

#### 返回结果示例

```
{
   "code": 200,
    "data": {
        "addr": "重庆-重庆市-城口县",
        "agency": "",
        "architectId": 0,
        "bidNo": "1",
        "boundType": "施工",
        "businessType": "",
        "cardNo": "",
        "city": "重庆市",
        "cityId": 500100,
        "companyId": 2739,
        "companyName": "中启建设有限公司",
        "contentId": 0,
        "district": "城口县",
        "districtId": 500170,
        "historyNames": "[{\"name\": \"2016-05-17\", \"value\": \"四川容百川建筑工程有限公司\"}]",
        "infoType": "",
        "label": "[\"公共建筑工程\",\"学校工程\"]",
        "lowerRate": 17.2068,
        "otherSource": "[{\"sourceName\":\"重庆市公共资源交易中心\",\"sourceUrl\":\"https://www.cqggzy.com/xxhz/014001/014001003/20180629/ed810386-3a14-49b1-b292-7d29cb804f91.html\"}]",
        "period": 0,
        "projectCategory": 0,
        "projectId": "1",
        "projectManager": "",
        "projectName": "重庆市城口县修齐镇第一中心小学迁建及幼儿园建设工程",
        "projectNature": "迁建",
        "projectType": 0,
        "projectTypeNew": "房建工程",
        "projectUnit": "城口县鼎兴农业开发有限公司",
        "projectUnitId": 89467,
        "province": "重庆",
        "provinceId": 500000,
        "regionName": "",
        "registerNo": "",
        "snapshootPic": "zb1_screenshot8513387322095291491.png",
        "sourceName": "重庆市招标投标综合网",
        "sourceUrl": "http://www.cqzb.gov.cn/zbgg-5-86905-2.aspx",
        "staffId": "",
        "staffName": "",
        "subjectMatterType": "工程",
        "tradeType": "其他",
        "winBidAmount": 6871.832787,
        "winBidTime": "2018-06-29"
    },
    "msg": "请求成功"
}

```
