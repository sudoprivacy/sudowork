# 一体化平台业绩-项目基本信息

**分类:** 一体化业绩
**路径:** `POST /v1/company/results/province/projectBasicDetails`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/province/projectBasicDetails

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pid | String | 50 | 是 | 项目id |


#### 请求示例

```
{
  "pid": "feb13413eefc86e9c73e0954c53333b6"
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| companyName | String | 255 | 是 | 企业名称 |
| projectType | String | 20 | 否 | 项目类型 |
| nature | String | 20 | 否 | 建设性质 |
| invest | Double | 15,4 | 否 | 项目总金额（万元） |
| province | String | 20 | 否 | 项目所在省 |
| city | String | 30 | 否 | 项目所在市 |
| conutry | String | 30 | 否 | 项目所在区县 |
| completion | Integer | - | 是 | 竣工数量 |
| contract | Integer | - | 是 | 合同登记数量 |
| licence | Integer | - | 是 | 施工许可数量 |
| tender | Integer | - | 是 | 招投标数量 |
| censor | Integer | - | 是 | 施工图审数量 |
| id | String | 50 | 是 | 项目id |
| purpose | String | 50 | 否 | 工程用途 |
| fundSource | String | 200 | 否 | 资金来源 |
| area | Double | 15,2 | 否 | 总面积（平方米） |
| length | Double | 15,2 | 否 | 总长度（米） |
| scale | String | 65535 | 否 | 建设规模 |
| planStartDate | String | 20 | 否 | 计划开工日期 |
| planEndDate | String | 20 | 否 | 计划竣工日期 |
| source | String | 10 | 否 | 数据来源 |
| dataLevel | String | 10 | 否 | 数据等级 |
| energySaveInfo | String | 65535 | 否 | 节能信息 |
| transfiniteInfo | String | 65535 | 否 | 超限项目信息 |
| nationalPercentTage | String | 255 | 否 | 国有资金出资比例 |
| buildPlanNo | String | 50 | 否 | 建设工程规划许可证编号 |
| buildCorpName | String | 255 | 否 | 建设单位名称 |
| buildCorpCode | String | 255 | 否 | 建设单位统一社会信用代码 |
| approvalLevel | String | 25 | 否 | 立项级别 |
| approvalNo | String | 50 | 否 | 立项文号 |
| address | String | 255 | 否 | 项目具体地点 |
| approvalDepart | String | 50 | 否 | 批复机关 |
| investNature | String | 50 | 否 | 工程投资性质 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
    "data": {
        "approvalNo": "2019-510703-39-03-340353",
        "purpose": "",
        "city": "绵阳市",
        "invest": 2400000,
        "projectType": "房建",
        "scale": "",
        "source": "四川省建筑市场监管公共服务平台",
        "buildCorpName": "绵阳惠科光电科技有限公司",
        "projectCode": null,
        "approvalDepart": "",
        "buildPlanNo": null,
        "id": "662585",
        "planEndDate": null,
        "energySaveInfo": null,
        "investNature": null,
        "area": null,
        "tender": 3,
        "completion": 0,
        "licence": 0,
        "address": "绵阳市涪城区惠科路1号",
        "nature": "新建",
        "contract": 0,
        "length": null,
        "transfiniteInfo": null,
        "fundSource": "",
        "buildCorpCode": "",
        "censor": 3,
        "nationalPercentTage": null,
        "projectName": "惠科第8.6代薄膜晶体管液晶显示器件项目",
        "approvalLevel": "",
        "planStartDate": null,
        "dataLevel": null
    },
    "msg": "请求成功"
}

```
