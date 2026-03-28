# 企业四库一平台业绩查询

**分类:** 四库业绩
**路径:** `POST /v1/company/results/companyResults`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/companyResults

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| companyId | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| keywords | String | 50 | 否 | 项目名称关键词 |
| bidAmountMin | String | 20 | 否 | 金额最小值（万元） |
| bidAmountMax | String | 20 | 否 | 金额最大值（万元） |
| provinces | String | 10 | 否 | 省份名称 |
| projectType | String | 10 | 否 | 项目类型：其他、市政基础设施工程、房屋建筑工程 |
| projectNodes | Array | - | 否 | 项目节点：1竣工验收备案，2合同，3施工许可，4招投标，5施工图审，6竣工验收 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
  "companyName": "中建三局集团有限公司",
  "pageIndex": 1,
  "pageSize": 2,
  "provinces": "湖北省",
  "projectType": "房屋建筑工程",
  "projectNodes": [
    1,
    2
  ]
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| projectNo | String | 50 | 是 | 项目id |
| purpose | String | 32 | 否 | 工程用途 |
| invest | Double | 20,4 | 否 | 总投资（万元） |
| projectType | String | 32 | 否 | 项目类型 |
| region | String | 30 | 否 | 地区 |
| projectName | String | 500 | 否 | 项目名称 |
| nature | String | 32 | 否 | 建设性质 |
| tender | Integer | - | 否 | 招投标数 |
| completion | Integer | - | 否 | 竣工备案数 |
| licence | Integer | - | 否 | 施工许可数 |
| contract | Integer | - | 否 | 合同登记数 |
| censor | Integer | - | 否 | 施工图审数 |
| buildCorpId | Long | - | 是 | 建设单位id |
| buildCorpName | String | 150 | 是 | 建设单位名称 |
| buildCorpCode | String | 150 | 否 | 建设单位统一社会信用代码 |
| area | Double | 20,2 | 否 | 总面积 |
| scale | String | 65535 | 否 | 建设规模 |
| completionCheck | Integer | - | 否 | 竣工验收数量 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
    "data": {
        "list": [
            {
                "tender": 1,
                "area": 60000.0,
                "completion": 1,
                "licence": 1,
                "purpose": "公共建筑",
                "nature": null,
                "invest": 30000.0,
                "contract": 1,
                "projectType": "房屋建筑工程",
                "scale": null,
                "buildCorpId": 10490,
                "projectNo": "4201060810080101",
                "buildCorpName": "中南建筑设计院股份有限公司",
                "buildCorpCode": "914200001775660",
                "censor": 1,
                "completionCheck": 0,
                "projectName": "中南建筑设计院科研设计中心工程",
                "region": "湖北省-武汉市-武昌区",
                "dataLevel": "B"
            },
            {
                "tender": 0,
                "area": 0.0,
                "completion": 1,
                "licence": 1,
                "purpose": null,
                "nature": null,
                "invest": 1000.0,
                "contract": 1,
                "projectType": "房屋建筑工程",
                "scale": null,
                "buildCorpId": 10411,
                "projectNo": "4201141508190102",
                "buildCorpName": "中建钢构武汉有限公司",
                "buildCorpCode": "58181204-9",
                "censor": 0,
                "completionCheck": 0,
                "projectName": "中建钢构武汉有限公司喷砂房建设项目",
                "region": "湖北省-武汉市-蔡甸区",
                "dataLevel": "C"
            }
        ],
        "totalCount": 156
    },
    "msg": "查询成功"
}

```
