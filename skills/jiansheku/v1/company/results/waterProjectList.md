# 企业水利业绩列表

**分类:** 水利业绩
**路径:** `POST /v1/company/results/waterProjectList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/waterProjectList

### 请求方式
POST(application/json)

### **请求参数**
********************
| 参数名称 | 数据类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| companyId | Integer | - | 是 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| timeType | Integer | - | 否 | 0：以开工日期为标准，1：以完工日期为标准 |
| startTime | String | 20 | 否 | 合同执行日期/开工日期（开始） “yyyy-mm-dd” 本字段使用必须传timeType，且只能为0或1 |
| endTime | String | 20 | 否 | 合同执行日期/开工日期（结束） “yyyy-mm-dd” 本字段使用必须传timeType，且只能为0或1 |
| keys | String | 255 | 否 | 项目名称 |
| statusEngineering | String | 20 | 否 | 信用、监管：工程状态 |
| minContractAmount | String | 255 | 否 | 合同金额 |
| source | String | 100 | 否 | 来源网站 |


#### **请求示例**

```
{
  "companyName": "中建三局集团有限公司",
  "pageIndex":"1",
  "pageSize":"2"

```
} 
 

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | string | 50 | 是 | 水利业绩id |
| projectName | string | 255 | 否 | 项目名称 |
| projectStatus | string | 20 | 否 | 项目状态 |
| contractAmount | Double | 30,4 | 否 | 合同金额（万元） |
| startTime | date | - | 否 | 开工日期 |
| endTime | date | - | 否 | 完工日期 |
| totalCount | integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 9,
    "list": [
      {
        "projectStatus": "开工在建",
        "web": "水利建设市场监管平台",
        "contractAmount": 17339.4419,
        "startTime": 1612454400000,
        "id": "00505252541014852985250484998539",
        "endTime": 1625328000000,
        "projectName": "西安市邓家村（一污一期）污水处理厂再生水化提标改造和加盖除臭工程"
      },
      {
        "projectStatus": "开工在建",
        "web": "全国水利建设市场信用信息平台",
        "contractAmount": 5153.7,
        "startTime": 1561651200000,
        "id": "00100995710148535510110052555655",
        "endTime": 1605110400000,
        "projectName": "青浦区徐泾镇“城中村”改造项目蟠龙塘、蟠龙河、北小港、蟠龙市河支浜河道整治工程"
      }
    ]
  }
}

```
