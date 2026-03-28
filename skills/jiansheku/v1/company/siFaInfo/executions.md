# 失信被执行信息

**分类:** 失信信息
**路径:** `POST /v1/company/siFaInfo/executions`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/siFaInfo/executions

### 请求方式
POST(application/json)

### 请求参数
********************
| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |
| uTags | Integer | - | 否 | 是否历史：1是，0否 |
| timeEnd | String | 20 | 否 | 时间止（yyyy-MM-dd） |
| timeStart | String | 20 | 否 | 时间起（yyyy-MM-dd） |


 

#### 请求示例

```
{
 "companyName": "眉山勇创健康管理有限公司",
 "pageIndex":1,
 "pageSize":1,
 "timeEnd": "2021-05-15",
 "timeStart": "2021-04-10"
}

```

### 响应参数
********************
| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| caseNumber | String | 255 | 否 | 案号 |
| court | String | 255 | 否 | 执行法院 |
| date | String | 50 | 否 | 立案日期 |
| docNumber | String | 255 | 否 | 执行依据文号 |
| exDepartment | String | 255 | 否 | 做出执行依据单位 |
| executionDesc | String | 65535 | 否 | 失信行为 |
| executionStatus | String | 255 | 否 | 被执行人的履行情况 |
| finalDuty | String | 65535 | 否 | 法律生效文书确定的义务 |
| name | String | 255 | 否 | 名称 |
| number | String | 255 | 否 | 组织构代码 |
| operName | String | 255 | 否 | 法定代表人 |
| province | String | 50 | 否 | 省份 |
| publishDate | String | 50 | 否 | 发布时间 |
| uTags | String | 10 | 否 | 状态 |
| totalCount | Integer | - | 是 | 总条数 |


 

#### 返回结果示例

```
{
  "code": 200,
    "data": {
        "list": [
            {
                "caseNumber": "（2023）川1402执2476号",
                "court": "眉山市东坡区人民法院",
                "date": "2023-08-15",
                "docNumber": "（2022）川1402民初4529号",
                "exDepartment": "眉山市东坡区人民法院",
                "executionDesc": "有履行能力而拒不履行生效法律文书确定义务",
                "executionStatus": "全部未履行",
                "finalDuty": "详见判决书",
                "id": "65660c88597f3318fe4cb9e0",
                "name": "眉山勇创健康管理有限公司",
                "number": "",
                "operName": "",
                "province": "四川",
                "publishDate": "2023-11-28",
                "status": "",
                "uTags": ""
            }
        ],
        "totalCount": 92
    },
    "msg": "查询成功"
}

```
