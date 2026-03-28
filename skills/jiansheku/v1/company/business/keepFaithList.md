# 守合同重信用

**分类:** 诚实守信
**路径:** `POST /v1/company/business/keepFaithList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/business/keepFaithList

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业Id |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |
| companyName | String | 255 | 否 | 企业名称 |


#### 请求示例

```
{
  "companyName": "中国华西工程设计建设有限公司",
  "pageIndex": 1,
  "pageSize": 1
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| companyName | String | 255 | 是 | 企业名称 |
| companyId | Integer | - | 是 | 企业id |
| org | String | 255 | 是 | 颁发机构 |
| level | String | 255 | 是 | 级别 |
| adr | String | 255 | 是 | 颁发机构所在地址（省市区县） |
| provinceId | Integer | - | 是 | 颁奖机构所在省id |
| districtId | Integer | - | 是 | 颁奖机构所在区县id |
| cityId | Integer | - | 否 | 颁奖机构所在市id |
| publishDate | String | 20 | 是 | 发布日期 “yyyy-MM-dd” |
| endDate | String | 20 | 否 | 结束日期 “yyyy-MM-dd” |
| year | String | 255 | 是 | 获奖年度 “yyyy-MM-dd” |
| yearStart | Integer | - | 是 | 获奖开始年份 |
| yearEnd | Integer | - | 是 | 获奖结束年份 |
| source | String | 65535 | 否 | 来源网站 json |
| pathSnapshot | String | 65535 | 否 | 快照截图 |
| fileUrl | String | 65535 | 否 | 附件链接 |
| url | String | 255 | 否 | 数据来源 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 4,
    "list": [
      {
        "id": "2433f116-0d59-11ed-893a-acde48001122",
        "companyName": "中国华西工程设计建设有限公司",
        "companyId": "11627",
        "org": "[\"国家市场监督管理总局\"]",
        "level": "国家级",
        "adr": "全国",
        "provinceId": 100000,
        "districtId": 0,
        "cityId": 0,
        "publishDate": "2012-06-01",
        "endDate": "",
        "year": "2010-2011",
        "yearStart": 2010,
        "yearEnd": 2011,
        "source": "[{\"sourceName\": \"国家市场监督管理总局\", \"sourceUrl\": \"\"}]",
        "pathSnapshot": null,
        "fileUrl": "[\"http://images.ipraction.gov.cn/www/201607/20160712081612936.doc\"]"
      }
    ]
  }
}

```
