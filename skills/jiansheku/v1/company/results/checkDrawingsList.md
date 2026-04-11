# 四库备案业绩-施工图审查节点信息查询

**分类:** 四库业绩
**路径:** `POST /v1/company/results/checkDrawingsList`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/results/checkDrawingsList

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
  "pageIndex":1,
  "pageSize":1,
  "pid":"1301012106180001"
}

```

### 应用级返回结果
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| censorCorpCode | String | 50 | 否 | 施工图审查机构统一社会信用代码 |
| censorCorpName | String | 50 | 否 | 施工图审查机构名称 |
| censorDate | Long | 20 | 否 | 审查完成日期 |
| censorNo | String | 50 | 否 | 施工图审查合格书编号 |
| checkDepartName | String | 50 | 否 | 信息审核部门 |
| checkPersonName | String | 255 | 否 | 信息审核人 |
| dataLevel | String | 10 | 否 | 数据等级 |
| dataSource | String | 10 | 否 | 数据来源 |
| engineeringName | String | 65535 | 否 | 工程名称 |
| isUnion | Integer | - | 否 | 是否联合审查 0否 1是 |
| onePass | Integer | - | 否 | 一次审查是否通过 通过为 1； 不通过为 0 |
| oneViolationCount | Integer | - | 否 | 一次审查时违反强制性标准数 |
| oneViolationEntryCount | String | 65535 | 否 | 一次审查时违反的强制性标准条目 |
| projectName | String | 255 | 是 | 项目名称 |
| provinceCensorNo | Integer | - | 否 | 省级施工图审查合格书编号 |
| recordDate | Long | 20 | 否 | 记录登记日期 |
| rfCensorCorpName | String | 50 | 否 | 人防审查机构 |
| rfCensorDate | Long | 20 | 否 | 人防设计审核时间 |
| rfCensorNo | Integer | - | 否 | 人防审查合格书编号 |
| scale | String | 65535 | 否 | 建设规模 |
| xfCensorCorpName | String | 50 | 否 | 消防审查机构 |
| xfCensorDate | Long | 20 | 否 | 消防设计审核时间 |
| xfCensorNo | String | 50 | 否 | 消防审查合格书编号 |
| id | String | 20 | 否 | 施工图审查id |
| totalCount | Integer | - | 是 | 总条数 |


 

#### 返回结果示例

```
{
  "code": 200,
  "msg": "查询成功",
  "data": {
    "totalCount": 14,
    "list": [
      {
        "oneViolationEntryCount": null,
        "provinceCensorNo": "2019J13010012478",
        "rfCensorNo": "D19-042",
        "checkDepartName": "石家庄市行政审批局",
        "isUnion": 1,
        "rfCensorCorpName": "河北博实工程设计咨询有限公司",
        "scale": "90420.49平方米",
        "onePass": 1,
        "xfCensorNo": "2019k13010010687",
        "xfCensorCorpName": "河北荣丰工程设计咨询有限公司",
        "censorNo": "1301012106180001-TX-004",
        "censorCorpName": "河北荣丰工程设计咨询有限公司",
        "censorCorpCode": "91130108601248693C",
        "oneViolationCount": null,
        "engineeringName": "盛世华安三期1#商业楼工程",
        "recordDate": 1621526400,
        "checkPersonName": "郝乐",
        "id": 18672959,
        "projectName": "盛世华安三期",
        "censorDate": 1564848000,
        "xfCensorDate": 1565280000000,
        "rfCensorDate": 1565884800,
        "dataSource": "历史业绩补录",
        "dataLevel": "B"
      }
    ]
  }
}

```
