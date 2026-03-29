# 企业变更信息

**分类:** 工商信息
**路径:** `POST /v1/company/industrial/records`
**Content-Type:** `application/json`

### 接口描述
根据企业查企业变更信息

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/records

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| cid | Integer | - | 否 | 企业id |
| companyName | String | 255 | 否 | 企业名称 |
| creditCode | String | 255 | 否 | 企业统一社会信用代码 |
| pageIndex | Integer | - | 否 | 页数 |
| pageSize | Integer | - | 否 | 条数 |


#### 请求示例

```
{
 "companyName": "平利县大贵镇肖芬超市",
 "pageIndx":1,
 "pageSize":1
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| afterContent | String | 65535 | 否 | 变更后内容 |
| beforeContent | String | 65535 | 否 | 变更前内容 |
| changeDate | String | 255 | 是 | 变更日期 |
| changeItem | String | 2000 | 是 | 变更名称 |
| type | String | 255 | 是 | 变更分类 种类太多 需要可导表 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "afterContent": "经营范围: 日用百货、日用杂品、针纺织品、文化用品、烟、预包装食品兼散装食品、乳制品（不含婴幼儿配方乳粉）零售(食品流通许可证有效期至2017年5月25日)。行业代码: 5229经营方式: 06",
                "changeDate": "2014-05-30",
                "changeItem": "经营范围变更",
                "type": "经营范围变更",
                "beforeContent": "经营范围: 日用百货、日用杂品、针纺织品、文化用品、烟、预包装食品兼散装食品、乳制品（含婴幼儿配方乳粉）零售。行业代码: 5200经营方式: 06"
            }
        ],
        "totalCount": 11
    },
    "msg": "查询成功"
}

```
返回code码见 API 前置说明
