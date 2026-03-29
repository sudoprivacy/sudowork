# 多条件搜索查询项目开标记录

**分类:** 招投标信息
**路径:** `POST /v1/company/bidding/newTouBiao/list`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/bidding/newTouBiao/list

### 请求方式
POST(application/json)

### 请求参数

| 参数名称 | 数据类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | String |  | 是 | 分页对象 json |
| page | Integer | - | 是 | 页数 |
| limit | Integer | - | 是 | 条数 |
| keyword | String | - | 否 | 关键词/项目名称 |
| jskBidQueryDto | String |  | 否 | 招标查询对象 json |
| companyName | String | 500 | 否 | 投标企业名称 |
| startBidMoney | Double | 16,6 | 否 | 投标金额 起 |
| endBidMoney | Double | 16,6 | 否 | 投标金额 止 |
| hasMoney | String | 8 | 否 | 包含金额未公示 yes是/no否 |
| startPunishDate | Date | - | 否 | 发布时间（开始） |
| endPunishDate | Date | - | 否 | 发布时间（结束） |
| province | String | 255 | 否 | 行政区划 传参 |


#### 请求示例

```
{
  "page": {
    "page": 1,
    "limit": 20
  },
  "keyword": "",
  "jskBidQueryDto": {
    "hasMoney": "",
    "companyName": "中建三局集团有限公司",
    "province": "420000"
  }
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| source | String | 255 | 否 | 来源网站 |
| punishDate | String | 10 | 否 | 发布时间 |
| id | Integer | - | 是 | 项目id |
| domicile | String | 255 | 否 | 行政区划 |
| projectName | String | 500 | 否 | 项目名称 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 3626,
    "list": [
      {
        "endPunishDate":null,
        "city":null,
        "companyName":null,
        "county":null,
        "overTime":null,
        "projectType":null,
        "agencyId":null,
        "industry":null,
        "source":"宜昌市公共资源交易中心",
        "punishDate":"2022-10-27",
        "title":null,
        "agencyContactTel":null,
        "contactTel":null,
        "contentInfo":null,
        "startTenderMoney":null,
        "startBidMoney":null,
        "endTenderMoney":null,
        "province":null,
        "startPunishDate":null,
        "subjectMatter":null,
        "contact":null,
        "tenderStage":null,
        "id":"1204317",
        "tenderingManner":null,
        "hasMoney":null,
        "agency":null,
        "queryScope":null,
        "agencyContact":null,
        "endBidMoney":null,
        "phonePoint":null,
        "bidMoney":null,
        "domicile":"湖北",
        "jskEid":null,
        "projectName":"鲟龙湾文化旅游项目城西三期建设项目一标段工程施工开标记录"
      }
    ]
  }
}

```
