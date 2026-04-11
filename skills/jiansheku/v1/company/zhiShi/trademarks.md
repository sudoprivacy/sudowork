# 商标信息

**分类:** 知识产权
**路径:** `POST /v1/company/zhiShi/trademarks`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/zhiShi/trademarks

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 是 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "companyName" : "深圳市摩力狮户外用品有限公司",
  "pageIndex":"1",
  "pageSize":"1"
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| addressCn | String | 255 | 否 | 注册地区 |
| agent | String | 255 | 否 | 专利代理机构 |
| applyDate | String | 50 | 否 | 申请日 |
| categoryFlag | String | 10 | 否 | 商标类别 |
| company | String | 255 | 否 | 申请人 |
| endDate | String | 50 | 否 | 结束日期(专用权期限) |
| firstPubdate | String | 50 | 否 | 初审公告日 |
| name | String | 255 | 否 | 商标名称 |
| notices | String | 65535 | 否 | 商标公告 |
| period | String | 50 | 否 | 专用期限 |
| processDate | String | 255 | 否 | 最后流程时间 |
| processYear | String | 255 | 否 | 最后流程年份 |
| products | String | 65535 | 否 | 商品/服务项目 |
| regNumber | String | 50 | 否 | 商标注册号 |
| regPubdate | String | 50 | 否 | 注册公告日 |
| startDate | String | 255 | 否 | 开始日期(专用权期限) |
| statusFlag | String | 10 | 否 | 商标状态 |
| steps | String | 65535 | 否 | 流程 |
| unitCode | String | 255 | 否 | 机构代码 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
 "code": 200,
    "data": {
        "list": [
            {
                "brief": "本实用新型涉及一种鞋带扣头、鞋舌扣柄和鞋带系紧装置，该鞋带扣头包括扣头把手和扣头基底，两两相对缝制在鞋背上端两边相对开口位置处，该扣头把手和扣头基底由连接件连接在一起。该鞋舌扣柄包括扣柄扣盖和扣柄基底，安装于鞋舌顶端，扣柄扣盖和扣柄基底由连接件连接在一起。该鞋带系紧装置由鞋带扣头、鞋舌扣柄和鞋带共同组成。鞋带的两端分别自鞋带扣头把手上的鞋带孔对穿后，在鞋舌扣柄位于打开位置时扣盖与基底片之间的孔隙穿过并打结；从而在第一次调整好鞋带的长度后利用鞋舌扣柄卡死鞋带，形成密闭式系统，以后只需打开或锁紧鞋带扣头即可松开和系紧鞋带完成脱穿鞋。本实用新型结构简单，设计合理，成本较低，使用范围广，易于推广应用，能够满足人们个性化的需求，具有较佳的社会经济价值。",
                "outhorDate": "",
                "outhorNum": "",
                "patentName": "鞋带扣头、鞋舌扣柄及鞋带系紧装置",
                "requestDate": "2008-01-29",
                "requestNum": "2008200043026",
                "type": "syxx",
                "typeName": "中国实用新型专利"
            }
        ],
        "totalCount": 3
    },
    "msg": "查询成功"
}

```
