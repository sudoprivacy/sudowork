# 著作权信息

**分类:** 知识产权
**路径:** `POST /v1/company/zhiShi/relations`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/zhiShi/relations

### 请求方式
POST(application/json)

### 请求参数




| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 是 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| typeName | String | 255 | 是 | 作品类别：摄影、文字、类似摄制电影方法创作的作品、音乐、美术、电影、建筑、其他、模型、地图、示意图、舞蹈、戏剧、录像、曲艺、口述、工程设计图、产品设计图、软件著作权证书、杂技、录音 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "companyName" : "中建三局集团有限公司",
  "typeName":"软件著作权证书",
  "pageIndex":"1",
  "pageSize":"2"
}

```

### 响应参数
********
| 参数名称 | 类型 | 长度 | 必填 | 参数说明 |
| --- | --- | --- | --- | --- |
| typeName | String | 255 | 否 | 作品类别 |
| firstDate | String | 20 | 否 | 首次发表日期 |
| shortName | String | 255 | 否 | 作品简称 |
| name | String | 255 | 否 | 作品 |
| number | String | 255 | 否 | 登记号 |
| approvalDate | String | 20 | 否 | 登记批准日期 |
| typeNum | String | 255 | 否 | 分类号 |
| company | String | 255 | 否 | 著作权人/所属企业 |
| successDate | String | 20 | 否 | 创作完成日期 |
| version | String | 50 | 否 | 版本号 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
	"code": 200,
    "data": {
        "list": [
            {
                "approvalDate": "2022-11-03",
                "company": "中建三局集团有限公司",
                "firstDate": "2022-06-16",
                "name": "中建三局全面预算管控信息系统",
                "number": "2022SR1458347",
                "shortName": "",
                "successDate": "2022-06-16",
                "typeName": "软件著作权证书",
                "typeNum": "",
                "version": "V1.0"
            },
            {
                "approvalDate": "2022-11-14",
                "company": "中建三局集团有限公司",
                "firstDate": "",
                "name": "造楼机三维监测平台",
                "number": "2022SR1500522",
                "shortName": "",
                "successDate": "2022-05-01",
                "typeName": "软件著作权证书",
                "typeNum": "",
                "version": "V1.0"
            }
        ],
        "totalCount": 156
    },
    "msg": "查询成功"
}

```
