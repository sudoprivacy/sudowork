# 四库业绩-参与单位及相关负责人信息查询

**分类:** 四库业绩
**路径:** `POST /v1/company/results/skyProBaseCorp`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/skyProBaseCorp

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pid | String | 50 | 是 | 项目id |
| type | Integer |  | 是 | 类型 1施工图审 2施工许可 3竣工验收备案  8企业业绩技术指标 |
| corpNo | String | 50 | 是 | 节点详情编号 |


#### 请求示例

```
{
  "pid": "3306021608300101",
  "type":3,
  "corpNo":"3306021608300101-JX-001"
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| censorNo | String | 50 | 否 | 施工图审查合格书编号 |
| cid | Integer | - | 是 | 企业id |
| completionCheckNo | String | 50 | 否 | 竣工验收编号 |
| type | Integer | - | 是 |  |
| censorNo | String | 50 | 否 | 施工图审编号 |
| completionNo | String | 50 | 否 | 竣工验收备案编号 |
| corpCode | String | 50 | 否 | 企业统一社会信用代码 |
| corpName | String | 255 | 是 | 企业名称 |
| corpRole | String | 50 | 否 | 企业承担角色 |
| licenceNo | String | 50 | 否 | 施工许可证编号 |
| personName | String | 50 | 否 | 负责人姓名 |
| projectCode | String | 100 | 否 | 项目代码 |
| staffId | String | 100 | 否 | 人员id |
| unitCode | String | 100 | 否 | 单体编码 |


 

#### 返回结果示例

```
{
  "code": 200,
  "msg": "操作成功",
  "data": [
    {
      "pageIndex": 1,
      "pageSize": 10,
      "corpRole": "勘察企业",
      "unitCode": "",
      "idCardType": "",
      "censorNo": null,
      "licenceNo": "3702111805150112-SX-001",
      "completionCheckNo": null,
      "completionNo": "3702111805150112-JX-001",
      "projectCode": "",
      "corpName": "青岛瑞源工程集团有限公司勘察测绘院",
      "corpCode": "91370211727829936R",
      "personName": null,
      "idCardNo": null,
      "staffId": null,
      "cid": 94127775
    }
  ]
}

```
