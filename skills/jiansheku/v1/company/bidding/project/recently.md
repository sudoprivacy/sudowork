# 中标业绩多条件组合查询

**分类:** 中标业绩
**路径:** `POST /v1/company/bidding/project/recently`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/bidding/project/recently

### 请求方式
POST(application/json)

### 请求参数
 
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | String | - | 是 | 分页对象 json |
| recentlyBidQueryDto | List | - | 否 | 最近中标数组对象 |

page对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| page | Integer | - | 是 | 页数 |
| limit | Integer | - | 是 | 条数 |

recentlyBidQueryDto对象
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| buildCorpName | String | 255 | 否 | 招标单位 |
| city | String | 255 | 否 | 项目所在市id（多个逗号隔开） |
| county | String | 255 | 否 | 项目所在区县id（多个逗号隔开） |
| ename | String | 255 | 否 | 中标单位名称或信用代码 |
| hasLowerRate | String | 255 | 否 | 是否包含下浮率未公示 yes/no |
| hasMoney | String | 255 | 否 | 是否包含金额未公示 yes/no |
| projectTypeNew | String | 255 | 否 | 工程类别 多个逗号隔开 |
| province | String | 255 | 否 | 项目所在省id（多个逗号隔开） |
| singleKeywordIn | String | 255 | 否 | 单项查询 关键词包含 |
| singleKeywordOut | String | 255 | 否 | 单项查询 关键词不包含 |
| sourceName | String | 255 | 否 | 来源平台 |
| tenderType | String | 255 | 否 | 中标类型 |
| startTenderTime | Date | - | 否 | 中标开始时间 |
| endTenderTime | Date | - | 否 | 中标结束时间 |
| startMoney | Double | 16,6 | 否 | 最小金额(万元) |
| endMoney | Double | 16,6 | 否 | 最大金额(万元) |


#### 请求示例

```
{
    "page": {
    "page": 1,
    "limit": 2,
    "order": "desc"
  },
"recentlyBidQueryDto": [

```
] } 
 

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| achievementType | String | 255 | 是 | 业绩类型 |
| division | String | 255 | 否 | 项目所在地（省市区县） |
| ename | String | 255 | 否 | 中标单位 |
| buildCorpName | String | 255 | 否 | 招标单位 |
| winBidAmount | Double | 16,6 | 是 | 中标金额(万元) |
| projectType | String | 255 | 否 | 建筑工程项目类型 |
| winBidTime | String | 20 | 否 | 中标时间 |
| jskEid | String | 255 | 否 | 中标单位id |
| pid | String | 255 | 否 | 项目id |
| otherSource | String | 65535 | 否 | 来源网站及链接 json |
| otherSource/sourceUrl | String | 255 | 否 | 来源链接 |
| otherSource/sourceName | String | 255 | 否 | 来源网站 |
| projectUnitId | Integer | - | 否 | 招标单位id |
| projectName | String | 255 | 否 | 项目名称 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "achievementType": "施工",
                "eid": null,
                "projectUnit": null,
                "winBidAmount": "8.4",
                "bidNo": null,
                "contentId": null,
                "projectType": "空白",
                "editId": null,
                "winBidTime": "2023-02-02",
                "pid": 141033051,
                "cityId": null,
                "projectUnitId": null,
                "districId": null,
                "lowerRate": null,
                "registerNo": null,
                "division": "广东省-深圳市",
                "sourceUrl": null,
                "updateId": null,
                "buildCorpName": null,
                "staffName": null,
                "projectAllName": null,
                "architectId": null,
                "id": null,
                "otherSource": [
                    {
                        "sourceUrl": "https://www.szygcgpt.com/ygcg/detailTop?com=Candidate&ggGuid=4ae1b046-f8a7-4b48-ba18-9d9826856666&bdGuid=8a94d35f-789b-4ef6-8cb0-2ca1a1e951a7&ggLeiXing=3&dataSource=1&type=purchase",
                        "sourceName": "深圳阳光采购平台"
                    }
                ],
                "tag": null,
                "md5Company": null,
                "period": null,
                "updateTime": null,
                "lowerRateStr": null,
                "provinceId": null,
                "bidType": null,
                "companyId": null,
                "ename": "广州市特威工程机械有限公司",
                "snapshootPic": null,
                "createTime": null,
                "sourceType": null,
                "createId": null,
                "name": null,
                "jskEid": 660199,
                "sourceName": null,
                "projectName": "天健二建公司40套Va型附墙采购",
                "staffId": null,
                "status": null
            },
            {
                "achievementType": "其他",
                "eid": null,
                "projectUnit": null,
                "winBidAmount": "178.28",
                "bidNo": null,
                "contentId": null,
                "projectType": "空白",
                "editId": null,
                "winBidTime": "2023-02-02",
                "pid": 141033049,
                "cityId": null,
                "projectUnitId": null,
                "districId": null,
                "lowerRate": null,
                "registerNo": null,
                "division": "广东省-深圳市",
                "sourceUrl": null,
                "updateId": null,
                "buildCorpName": null,
                "staffName": null,
                "projectAllName": null,
                "architectId": null,
                "id": null,
                "otherSource": [
                    {
                        "sourceUrl": "https://www.szygcgpt.com/ygcg/detailTop?com=Candidate&ggGuid=91c455cc-bcce-4352-a1e6-bca8fd881bc0&bdGuid=8e50a828-2d38-4781-9b1e-bc8b1887125b&ggLeiXing=3&dataSource=0&type=purchase",
                        "sourceName": "深圳阳光采购平台"
                    }
                ],
                "tag": null,
                "md5Company": null,
                "period": null,
                "updateTime": null,
                "lowerRateStr": null,
                "provinceId": null,
                "bidType": null,
                "companyId": null,
                "ename": "深圳市宝谊实业有限公司",
                "snapshootPic": null,
                "createTime": null,
                "sourceType": null,
                "createId": null,
                "name": null,
                "jskEid": 213469133,
                "sourceName": null,
                "projectName": "天健二建公司2022年度临时镀锌消防管材采购",
                "staffId": null,
                "status": null
            }
        ],
        "totalCount": 12625615
    },
    "msg": "查询成功"
}

```
