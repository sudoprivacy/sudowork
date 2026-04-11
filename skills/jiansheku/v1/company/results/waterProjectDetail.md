# 水利业绩-项目基本信息详情查询

**分类:** 水利业绩
**路径:** `POST /v1/company/results/waterProjectDetail`
**Content-Type:** `application/json`

## **水利中标信息**

### **接口描述**
通过水利中标id水利中标信息。

### **字符编码**
UTF-8

### **请求地址**
/v1/company/results/waterProjectDetail

### **请求方式**
POST(application/json)

### **请求参数**
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | String | 50 | 是 | 水利业绩id |


#### **请求示例**
{
  "id":"00544956994910052491005254101575"
}

### **响应参数**
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| contractDate | Date | - | 是 | 合同签订日期 |
| contractDay | Double | 20,4 | 否 | 合同工期（天） |
| jskEid | String | 20 | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| projectType | String | 20 | 否 | 项目类型 |
| overTimeProjectPrincipal | Date | - | 是 | 项目负责人任职结束日期 |
| engineerPrincipal | String | 50 | 否 | 技术负责人 |
| contractAmount | Double | 30,4 | 否 | 合同金额（万元） |
| web | String | 100 | 否 | 来源网站 |
| overTimeEngineerPrincipal | Date | - | 否 | 技术负责人任职结束日期 |
| projectCode | String | 255 | 否 | 项目编号 |
| keyIndex | String | 65535 | 否 | 工程关键指标 |
| contractName | String | 255 | 否 | 合同名称 |
| startTimeEngineerPrincipal | Date | - | 否 | 技术负责人任职开始日期 |
| startTimeFact | Date | - | 否 | 实际开工日期 |
| address | String | 150 | 否 | 项目所在地（省市区县） |
| chargeDepartment | String | 150 | 否 | 项目主管部门 |
| level | String | 20 | 否 | 工程等别 |
| projectPrincipal | String | 50 | 否 | 项目负责人 |
| startTimeProjectPrincipal | Date | - | 否 | 项目负责人任职开始日期 |
| overTimeFact | Date | - | 否 | 实际竣工日期 |
| contractContent | String | 65535 | 否 | 合同主要内容 |
| projectStatus | String | 20 | 否 | 工程状态 |
| buildType | String | 255 | 否 | 工程建设模式 |
| grade | String | 20 | 否 | 工程等级 |
| factDay | Double | 20,4 | 否 | 实际工期（天） |
| settlementAmount | Double | 30,4 | 否 | 结算金额（万元） |
| projectName | String | 255 | 否 | 项目名称 |
| projectScale | String | 50 | 否 | 工程规模 |
| reportCommitDate | Date | - | 否 | 报告提交日期 |
| bidAmount | Double | 20,4 | 否 | 中标金额（万元） |
| dataType | String | 30 | 否 | 工程类型 |
| startTime | Date | - | 否 | 开工日期/合同执行期（开始）/监理开始日期/检测开始日期 |
| endTime | Date | - | 否 | 完工日期/合同执行期（结束）/监理结束日期/检测结束日期 |
| companyName | String | 255 | 是 | 企业名称 |
| reportCommitDate | Date | 20 | 否 | 报告提交日期 |
| totalCount | Integer | - | 是 | 总条数 |


#### **返回结果示例**
{
  "code": 200,
  "msg": "请求成功",
  "data": {
    "contractDate": 1621440000000,
    "contractDay": 365,
    "projectType": "水库",
    "overTimeProjectPrincipal": 1652889600000,
    "constructUnit": "达茂旗水库管理处",
    "statTimeProjectPrincipal": 1621440000000,
    "engineerPrincipal": "郭晓英",
    "projectCode": "G2021SL002",
    "overTimeEngineerPrincipal": 1652889600000,
    "web": "水利建设市场监管平台",
    "keyIndex": "根据类似地区防渗墙施工的经验，并按设计要求，拟定本主坝防渗墙工程总体施工\n方法为：\n（1）采用 CT-30 型冲击钻机钻孔成槽。\n（2）采用膨润土泥浆护壁。\n（3）“套桶法”置换泥浆清孔。\n（4）混凝土搅拌站拌和混凝土。\n82\n（5）HBT60 砼输送泵输送混凝土。\n（6）泥浆下直升导管法浇筑混凝土。\n（7）钢丝绳辅助混凝土浇筑。\n施工工艺流程\n防渗墙采用“钻劈法”造孔，即冲击钻造孔成槽，泥浆护壁，导管法浇筑水下砼成\n墙。\n成墙的施工工序：修筑导墙和施工平台→划分槽段→一期槽孔开挖→浇筑混凝土→\n二期槽孔",
    "factDuration": "2021-05-20至共天",
    "contractName": "包头市达茂旗青龙湾水库除险加固工程施工标段施工",
    "startTime": 1621440000000,
    "id": "00544956994910052491005254101575",
    "startTimeEngineerPrincipal": 1621440000000,
    "startTimeFact": 1621440000000,
    "address": "内蒙古/包头",
    "chargeDepartment": "",
    "projectPrincipal": "郭玉霞",
    "level": "4",
    "dataType": "施工",
    "overTimeFact": null,
    "bidAmount": null,
    "contractContent": "工程内容：对大坝上游原局部沉降、塌陷砌石护坡进行整理、修复。大坝下游护坡采用\n混凝土网格碎石护坡进行加固，加固修建下游排水沟。采用塑性混凝土防渗墙进行坝基\n及坝体防渗，防渗墙体厚 0.6m，防渗墙顶高程为 1604. 5m，防渗墙底高程为坝基弱风\n化层下 2m，防渗墙向左坝肩延长 30m。对溢洪道进口段两侧混凝土边墙加长，并对两侧\n边墙上部边坡进行喷锚支护。增加大坝坝面水平位移和垂直位移的观测、渗流监测、混\n凝土防渗墙监测设施。",
    "projectStatus": "开工在建",
    "buildType": "DBB",
    "grade": "IV",
    "jskEid": 730,
    "contractAmount": 899.9653,
    "factDay": null,
    "endTime": 1652889600000,
    "settlementAmount": null,
    "projectName": "包头市达茂旗青龙湾水库除险加固工程施工标段施工",
    "projectScale": "小(1)型",
    "companyName": "安徽九华水安集团有限公司",
    "productStandard": "",
    "reportCommitDate": "",
    "sourceOfDrawings": ""  
  }
}
返回code码见 API 前置说明
