# 企业一体化平台业绩查询

**分类:** 一体化业绩
**路径:** `POST /v1/company/results/province/projectPerformance`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/province/projectPerformance

### 请求方式
POST(application/json)

### 请求参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| companyId | String | 255 | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| web | String | 255 | 否 | 来源网站 |
| projectNodes | Array |  | 否 | 项目环节(1:招投标 2:合同登记 3:施工图审查 4:施工许可 5:竣工验收备案 6:竣工验收) |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |
| maxInvest | Double | 15,4 | 否 | 最大项目总金额（万元） |
| minInvest | Double | 15,4 | 否 | 最小项目总金额（万元） |
| projectType | String | 32 | 否 | 项目类型 |
| nature | String | 32 | 否 | 工程用途 |
| projectName | String | 255 | 否 | 项目名称 |
| bidTimeStart | String | 20 | 否 | 中标时间起 |
| bidTimeEnd | String | 20 | 否 | 中标时间止 |
| pid | String | 50 | 否 | 项目编号 |


#### 请求示例

```
{
  "companyName":"中建三局集团有限公司",
  "web":"四川省建筑市场监管公共服务平台",
  "projectNodes":[1],
  "pageIndex":1,
  "pageSize": 1
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| projectName | String | 255 | 是 | 项目名称 |
| projectType | String | 255 | 否 | 项目类型 |
| nature | String | 255 | 否 | 建设性质 |
| invest | Double | 15,4 | 否 | 项目总金额（万元） |
| province | String | 20 | 否 | 省 |
| city | String | 30 | 否 | 市 |
| conutry | String | 30 | 否 | 区县 |
| completion | Integer | - | 是 | 竣工数量 |
| contract | Integer | - | 是 | 合同登记数量 |
| licence | Integer | - | 是 | 施工许可数量 |
| tender | Integer | - | 是 | 招投标数量 |
| censor | Integer | - | 是 | 施工图审数量 |
| id | String | 50 | 是 | 项目id |
| purpose | String | 32 | 否 | 工程用途 |
| buildCorpName | String | 255 | 否 | 建设单位名称 |
| buildCorpCode | String | 255 | 否 | 建设单位统一社会信用代码 |
| completionCheck | Integer | - | 否 | 竣工验收数量 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 51,
    "list": [
      {
        "tender": 3,
        "completion": 0,
        "licence": 1,
        "city": "绵阳市",
        "purpose": "",
        "nature": "新建",
        "invest": 2400000.0,
        "contract": 0,
        "county": "涪城区",
        "projectType": "房建",
        "province": "四川省",
        "buildCorpName": "绵阳惠科光电科技有限公司",
        "web": "四川省建筑市场监管公共服务平台",
        "buildCorpCode": "",
        "censor": 3,
        "completionCheck": 0,
        "id": "feb13413eefc86e9c73e0954c53333b6",
        "projectName": "惠科第8.6代薄膜晶体管液晶显示器件项目"
      }
    ]
  }
}

```
