# 四库备案业绩-合同登记节点信息查询

**分类:** 四库业绩
**路径:** `POST /v1/company/results/contractList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/contractList

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
  "pid": 3101151211210104,
  "pageIndex": 1,
  "pageSize": 1
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| contractDate | Long | 20 | 否 | 合同签订日期 |
| contractNo | String | 50 | 否 | 合同编号 |
| contractType | String | 20 | 否 | 合同类别 |
| contractorCorpCode | String | 50 | 否 | 承包单位统一社会信用代码 |
| contractorCorpId | String | 255 | 否 | 承包单位id |
| contractorCorpName | String | 255 | 否 | 承包单位名称 |
| dataLevel | String | 10 | 否 | 数据等级 |
| dataSource | String | 10 | 否 | 数据来源 |
| engineeringName | String | 65535 | 否 | 工程名称 |
| money | Double | 30,4 | 否 | 合同金额(万元) |
| projectName | String | 255 | 否 | 项目名称 |
| propietorCorpCode | String | 50 | 否 | 发包单位统一社会信用代码 |
| propietorCorpName | String | 255 | 否 | 发包单位名称 |
| provinceContractNo | String | 50 | 否 | 省级合同备案编号 |
| recordDate | Long | 20 | 否 | 记录登记时间 |
| recordNo | String | 50 | 否 | 合同登记编号 |
| scale | String | 65535 | 否 | 建设规模 |
| unionCorpCode | String | 50 | 否 | 联合体承包单位统一社会信用代码 |
| unionCorpId | String | 255 | 否 | 联合承包单位id |
| unionCorpName | String | 255 | 否 | 联合体承包单位名称 |
| id | Long | 20 | 是 | 合同登记信息详情id |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 141,
    "list": [
      {
        "contractDate": 1459785600,
        "propietorCorpCode": "13221006-9",
        "contractorCorpCode": "MA1JX99U-3",
        "contractNo": "1201PD0077CZ02F46",
        "contractType": "施工劳务",
        "unionCorpId": null,
        "scale": null,
        "contractorCorpId": 712052,
        "recordNo": "3101151211210104-HL-044",
        "provinceContractNo": null,
        "money": 49.9,
        "engineeringName": null,
        "contractorCorpName": "上海上园建筑劳务有限公司",
        "recordDate": 1517846400,
        "unionCorpName": null,
        "id": 8881209,
        "projectName": "上海科技大学新校区一期、中国科学院上海浦东科技园二期项目",
        "propietorCorpName": "上海园林（集团）有限公司",
        "dataSource": null,
        "dataLevel": "D",
        "unionCorpCode": null
      }
    ]
  }
}

```
