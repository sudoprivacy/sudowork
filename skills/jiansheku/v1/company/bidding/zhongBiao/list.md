# 企业中标业绩列表

**分类:** 中标业绩
**路径:** `POST /v1/company/bidding/zhongBiao/list`
**Content-Type:** `application/json`

### 请求地址
/v1/company/bidding/zhongBiao/list

### 请求方式
POST(application/json)

### 请求参数
********
| 参数名称 | 数据类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |
| projectAllName | String | 255 | 否 | 项目关键字 |
| provinceId | Integer | - | 否 | 项目所在省id |
| timeEnd | String | 20 | 否 | 中标时间（结束） |
| timeStart | String | 20 | 否 | 中标时间（开始） |
| winBidAmountQ | String | 20 | 否 | 项目金额（结束） |
| winBidAmountS | String | 20 | 否 | 项目金额（开始） |


#### 请求示例

```
{
 "companyName": "中启建设有限公司",
 "pageIndex":1,
 "pageSize":1,
 "projectAllName": "洛阳市滨河南路（西苑桥至文仲大道段）拓宽改造工程-交通监控供电工程"
}

```

### 响应参数
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| projectName | String | 350 | 否 | 工程全称 |
| provinceId | Integer | - | 否 | 项目所在省id |
| cityId | Integer | - | 否 | 项目所在市id |
| districtId | Integer | - | 否 | 项目所在区县id |
| winBidAmount | Double | 16,6 | 否 | 中标金额 |
| winBidTime | String | 20 | 否 | 中标时间 |
| sourceName | String | 50 | 否 | 来源名称 |
| sourceUrl | String | 500 | 否 | 来源路径 |
| companyName | String | 255 | 否 | 中标单位 |
| projectId | String | 11 | 否 | 项目详情id |
| projectManager | String | 30 | 否 | 项目经理 |
| registerNo | String | 20 | 否 | 执业印章号 |
| staffId | String | 32 | 否 | 人员ID |
| otherSource | String | 1500 | 否 | 其他来源 |
| bidNo | String | 100 | 否 | 中标项目编号 |
| lowerRate | Double | 12,6 | 否 | 下浮率% |
| period | Integer | - | 否 | 工期 |
| agency | String | 255 | 否 | 招标代理机构 |
| snapshootPic | String | 150 | 否 | 中标快照 |
| contentId | Integer | - | 否 | 正文ID |
| regionName | String | 255 | 否 | 项目所在省 |
| econKind | String | 255 | 否 | 企业性质 |
| projectUnit | String | 255 | 否 | 招标单位 |
| buildingProjectType | Integer | - | 否 | 建筑工程项目类型 |
| totalCount | Integer | - | 是 | 总条数 |


 

#### 返回结果示例

```
{
   "code": 200,
    "data": {
        "list": [
            {
                "agency": "",
                "architectId": 0,
                "bidNo": "",
                "buildingProjectType": "房建工程",
                "cityId": 0,
                "companyName": "中启建设有限公司",
                "contentId": 0,
                "districtId": 0,
                "econKind": "有限责任公司（自然人投资或控股）",
                "lowerRate": 0,
                "otherSource": "",
                "period": 0,
                "projectId": "150537747",
                "projectManager": "",
                "projectName": "新园区建设项目聚氨酯板块施工装饰装修专业分包",
                "projectUnit": "六冶长城建设分公司",
                "provinceId": 100000,
                "regionName": "全国",
                "registerNo": "",
                "snapshootPic": "bid/1505377471710240809861.jpg",
                "sourceName": "中国铝业集团有限公司电子采购交易系统",
                "sourceUrl": "http://ec.chalieco.com:5835/b2b/web/two/indexinfoAction.do?actionType=showPxjgDetail&xxbh=BD2D191E48D00D4B267E13FB69F2F4BB",
                "staffId": "",
                "winBidAmount": 368.688055,
                "winBidTime": "2023-12-29"
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
