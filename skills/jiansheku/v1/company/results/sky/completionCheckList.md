# 四库备案业绩-竣工验收节点信息查询

**分类:** 四库业绩
**路径:** `POST /v1/company/results/sky/completionCheckList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/sky/completionCheckList

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| pid | String | 50 | 是 | 项目id |
| pageIndex | Integer | - | 是 | 页数 |
| pageSize | Integer | - | 是 | 条数 |


#### 请求示例

```
{
  "pid": "4419002010100005",
  "pageIndex":1,
  "pageSize":2
}

```

### 响应参数
********
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| area | String | 30 | 否 | 实际面积 （平方米） |
| endDate | String | 20 | 否 | 竣工验收备案日期“yyyy-mm-dd” |
| length | Double | 10,4 | 否 | 长度（米） |
| scale | String | 65535 | 否 | 实际建设规模 |
| licenceNo | String | 50 | 否 | 施工许可证编号 |
| completionCheckNo | String | 50 | 是 | 竣工验收编号 |
| structure | String | 20 | 否 | 结构体系 |
| money | Double | 20,4 | 否 | 实际造价 （万元） |
| projectCode | String | 50 | 否 | 项目代码 |
| mark | String | 65535 | 否 | 备注 |
| id | Long | - | 否 | id |
| dataLevel | String | 10 | 否 | 数据等级 |
| startDate | String | 20 | 否 | 实际开工日期“yyyy-mm-dd” |
| span | Double | 10,4 | 否 | 跨度 （米） |
| projectName | String | 255 | 是 | 项目名称 |
| engineeringName | String | 255 | 否 | 工程名称 |
| recordDate | String | 20 | 否 | 登记记录时间“yyyy-mm-dd” |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "area": 7155.08,
                "endDate": "2022-04-27",
                "length": 0.0,
                "scale": "框架0（1）层1幢",
                "completionCheckNo": "4419002009290102-JX-009",
                "licenceNo": "4419002010100005-SX-001",
                "structure": "框架结构",
                "money": 1004.68,
                "projectCode": null,
                "engineeringName": "光大科技智慧谷三区3号厂房(框架8层1幢)",
                "recordDate": "2022-06-02",
                "id": 547672,
                "projectName": "光大科技智慧谷三区",
                "startDate": "2020-10-28",
                "dataLevel": "B",
                "mark": null,
                "span": 0.0
            },
            {
                "area": 27237.18,
                "endDate": "2022-04-27",
                "length": 0.0,
                "scale": "框架剪力墙1幢17层",
                "completionCheckNo": "4419002009290102-JX-007",
                "licenceNo": "4419002010100005-SX-002",
                "structure": "框架－剪力墙结构",
                "money": 3824.52,
                "projectCode": null,
                "engineeringName": "光大科技智慧谷三区3号厂房(框架8层1幢)",
                "recordDate": "2022-05-25",
                "id": 547671,
                "projectName": "光大科技智慧谷三区",
                "startDate": "2020-10-28",
                "dataLevel": "B",
                "mark": null,
                "span": 0.0
            }
        ],
        "totalCount": 9
    },
    "msg": "查询成功"
}

```
