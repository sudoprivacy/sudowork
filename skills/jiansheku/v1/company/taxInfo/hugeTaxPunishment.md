# 重大税收违法信息

**分类:** 经营风险
**路径:** `POST /v1/company/taxInfo/hugeTaxPunishment`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/taxInfo/hugeTaxPunishment

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
  	"companyName": "国粮粮食储备（大连）有限公司",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| caseType | String | 255 | 否 | 案件性质 |
| checkDepartment | String | 255 | 否 | 检查机关 |
| financialPeople | String | 255 | 否 | 负有直接责任的财务负责人姓名 |
| lawPunishment | String | 65535 | 否 | 相关法律依据及税务处理处罚情况 |
| orgCode | String | 255 | 否 | 组织机构代码 |
| personName | String | 255 | 否 | 法定代表人或者负责人姓名 |
| police | String | 255 | 否 | 移送公安情况 |
| pubDepartment | String | 255 | 否 | 所属税务机关 |
| registerAddre | String | 255 | 否 | 注册地址 |
| taxNum | String | 255 | 否 | 纳税人识别号 |
| taxpayerName | String | 255 | 否 | 纳税人名称 |
| time | String | 255 | 否 | 发生时间 |
| truth | String | 65535 | 否 | 主要违法事实 |
| url | String | 255 | 否 | 原文链接 |
| agencyPeople | String | 255 | 否 | 负有直接责任的中介机构信息及其从业人员信息 |
| totalCount | Integer | - | 是 | 总条数 |


 

#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "pubDepartment": "",
                "registerAddre": "辽宁省大连市甘井子区西南路芳林园17号1单元10层1号",
                "updateTime": 1640946648186,
                "lawPunishment": "依照《中华人民共和国税收征收管理法》等相关法律法规的有关规定，对其处以罚款10万元的行政处罚，依法移送公安机关。",
                "url": "http://dalian.chinatax.gov.cn/art/2021/8/5/art_3461_1414.html",
                "financialPeople": "",
                "caseType": "虚开普通发票",
                "personName": "",
                "police": "",
                "truth": "经国家税务总局大连市甘井子区税务局检查，发现其在2018年01月01日至2018年12月31日期间，主要存在以下问题:虚开普通发票555份，票面额累计4325.55万元。",
                "checkDepartment": "国家税务总局大连市甘井子区税务局",
                "orgCode": "",
                "agencyPeople": "",
                "taxpayerName": "",
                "createdTime": 1629432118407,
                "taxNum": "91210200MA0QECKN5M",
                "time": "2021-07"
            }
        ],
        "totalCount": 1
    },
    "msg": "查询成功"
}

```
