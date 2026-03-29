# 招标项目搜索

**分类:** 招投标信息
**路径:** `POST /v1/company/bidding/newZhaoBiao/list`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/bidding/newZhaoBiao/list

### 请求方式
POST(application/json)

### 请求参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| keyword | String | - | 否 | 关键词/项目名称 |
| keywordNot | String | 255 | 否 | 关键词不包含 |
| page | String | - | 是 | 分页对象 json |
| jskBidQueryDto | String | - | 否 | 招标查询对象 json |

jskBidQueryDto对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| agency | String | 255 | 否 | 招标代理机构 |
| source | String | 255 | 否 | 来源网站 |
| phonePoint | String | 255 | 否 | 联系电话多个逗号,隔开 |
| province | String | 255 | 否 | 省- 多个逗号,隔开 |
| city | String | 255 | 否 | 市- 多个逗号,隔开 |
| county | String | 255 | 否 | 区- 多个逗号,隔开 |
| companyName | String | 255 | 否 | 招标单位 |
| startBidMoney | String | 255 | 否 | 招标金额 起(万元) |
| endBidMoney | String | 255 | 否 | 招标金额 止(万元) |
| startPunishDate | Date | - | 否 | 发布时间（开始） |
| endPunishDate | Date | - | 否 | 发布时间（结束） |
| projectType | String | 255 | 否 | 项目类型 |
| queryScope | String | 255 | 否 | 查询范围 |
| subjectMatter | String | 255 | 否 | 标的物类型 |
| tenderingManner | String | 255 | 否 | 招标方式（交易类型） |
| tenderStage | String | 255 | 否 | 招标阶段 |

page对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Integer | - | 是 | 页数 |
| limit | Integer | - | 是 | 条数 |


 

#### 请求示例

```
{
  "page": {
    "page": 1,
    "limit": 2
  },
  "jskBidQueryDto": {
    "province": "",
    "city": "",
    "county": "110101",
    "tenderStage": "废标公告",
    "tenderingManner": "邀请",
    "queryScope": "",
    "projectType": "冶金工程",
    "subjectMatter": "工程",
    "startBidMoney": 300,
    "endBidMoney": 1000,
    "startPunishDate": "2022-08-01",
    "endPunishDate": "2022-11-28",
    "companyName": "招采单位",
    "agency": "招标代理"
  },
  "keyword": "关键词"
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | String | 36 | 是 | 项目id |
| projectName | String | 800 | 否 | 项目名称 |
| companyName | String | 255 | 否 | 招标单位 |
| bidMoney | Double | 19,2 | 否 | 项目金额，单位为万元 |
| punishDate | Date | - | 是 | 发布时间 |
| overTime | Date | - | 否 | 截止时间 |
| jskEid | Integer | - | 否 | 招标单位id |
| contact | String | 255 | 否 | 招标单位联系人 |
| contactTel | String | 255 | 否 | 招标单位联系人方式 |
| tenderingManner | String | 60 | 否 | 招标方式（交易类型） ：”询价”, “比选”, “邀请”, “竞争性谈判”, “竞争性磋商”, “单一来源”, “竞价”, “直接发包”, “公开招标”,其他 |
| tenderStage | String | 60 | 否 | 招标阶段 |
| projectType | String | 80 | 否 | 项目类型 |
| agency | String | 255 | 否 | 招标代理机构 |
| agencyId | Integer | - | 否 | 招标代理机构id |
| agencyContact | String | 255 | 否 | 招标代理机构联系人 |
| agencyContactTel | String | 255 | 否 | 招标代理机构联系方式 |
| domicile | String | 255 | 否 | 项目所在地（省市区县） |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 1077876,
    "list": [
      {
        "endPunishDate":null,
        "city":null,
        "companyName":null,
        "county":null,
        "overTime":null,
        "projectType":"水利工程",
        "agencyId":32202,
        "industry":null,
        "source":null,
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
        "tenderStage":"更正公告",
        "id":"fde9212e-72dc-4e83-8293-3954e4ab7101",
        "tenderingManner":"其他",
        "hasMoney":null,
        "agency":"广西桂水工程咨询有限公司",
        "queryScope":null,
        "agencyContact":null,
        "endBidMoney":null,
        "phonePoint":null,
        "bidMoney":null,
        "domicile":"贵州省黔南布依族苗族自治州龙里县",
        "jskEid":0,
        "projectName":"龙里县平山村（新水片区）应急供水工程的更正公告"
      },
      {
        "endPunishDate":null,
        "city":null,
        "companyName":null,
        "county":null,
        "overTime":null,
        "projectType":"水利工程",
        "agencyId":0,
        "industry":null,
        "source":null,
        "punishDate":"2022-10-27",
        "title":null,
        "agencyContactTel":null,
        "contactTel":"0416-2305888",
        "contentInfo":null,
        "startTenderMoney":null,
        "startBidMoney":null,
        "endTenderMoney":null,
        "province":null,
        "startPunishDate":null,
        "subjectMatter":null,
        "contact":null,
        "tenderStage":"招标公告",
        "id":"fda8f6fc-f66b-4bf0-9ac0-04f9de8dbadd",
        "tenderingManner":"公开招标",
        "hasMoney":null,
        "agency":null,
        "queryScope":null,
        "agencyContact":null,
        "endBidMoney":null,
        "phonePoint":null,
        "bidMoney":99935.27,
        "domicile":"辽宁省锦州市黑山县",
        "jskEid":0,
        "projectName":"黑山县龙湾水库、友邻水库特许经营项目招标公告"
      }
    ]
  }
}

```
