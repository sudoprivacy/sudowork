# 四库备案业绩-招投标节点信息查询

**分类:** 四库业绩
**路径:** `POST /v1/company/results/bidZhaoTouList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/bidZhaoTouList

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |
| pid | String | 32 | 是 | 项目id |


#### 请求示例

```
{
  "pid": 4408831511029901,
  "pageIndex": 1,
  "pageSize": 1
}

```
 
 

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| agencyCorpCode | String | 50 | 否 | 招标代理单位统一社会信用代码 |
| agencyCorpName | String | 100 | 否 | 招标代理单位名称 |
| area | Double | 15,4 | 否 | 面积（平方米） |
| dataLevel | String | 10 | 否 | 数据等级 |
| dataSource | String | 10 | 否 | 数据来源 |
| engineeringname | String | 65535 | 否 | 工程名称 |
| money | Double | 30,4 | 否 | 中标金额（万元） |
| pmId | String | 36 | 是 | 人员id |
| pmName | String | 100 | 否 | 项目经理/总监理工程师姓名 |
| projectName | String | 255 | 否 | 项目名称 |
| provinceTenderNo | String | 50 | 否 | 省级中标通知书编号 |
| recordDate | Long | 20 | 否 | 记录登记时间 |
| scale | String | 65535 | 否 | 建设规模 |
| tenderCorpCode | String | 50 | 否 | 中标单位统一社会信用代码 |
| tenderCorpId | String | 20 | 是 | 中标单位id |
| tenderCorpName | String | 255 | 否 | 中标单位名称 |
| tenderDate | Long | 20 | 否 | 中标日期 |
| tenderNo | String | 50 | 否 | 中标通知书编号 |
| tenderType | String | 20 | 否 | 招标类型 |
| tenderWay | String | 20 | 否 | 招标方式 |
| id | String | 20 | 否 | 招投标id |
| totalCount | Integer | - | 否 | 总条数 |


 

#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 1,
    "list": [
      {
        "area": 0,
        "tenderCorpName": "广东三穗建筑工程有限公司",
        "pmCardNo": "440821196815",
        "pmCardType": "身份证",
        "scale": "长度（575.16米）、宽度（13米）",
        "pmName": "吴英松",
        "agencyCorpCode": "00710520-0",
        "pmId": "33dda5a6753544248884f8467a51d53d",
        "agencyCorpName": "吴川市公用事业局",
        "tenderCorpCode": "19467047-4",
        "tenderType": "施工",
        "tenderWay": "公开招标",
        "money": 861.28,
        "tenderDate": 1421337600,
        "tenderNo": "4408831511029901-BD-001",
        "recordDate": 1446393600,
        "id": 7456675,
        "projectName": "吴川市长寿路改造工程",
        "provinceTenderNo": "4408831511029901-BD-001",
        "dataLevel": "D",
        "tenderCorpId": 39750
      }
    ]
  }
}

```
