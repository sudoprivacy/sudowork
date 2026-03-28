# 双随机抽查结果

**分类:** 工商信息
**路径:** `POST /v1/company/industrial/double/checkups`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/double/checkups

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
  	"companyName": "定远县羊羊得益种养殖专业合作社",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 参数说明 |
| --- | --- | --- | --- | --- |
| details | String | 65535 | 否 | 详情列表 |
| insAuth | String | 1000 | 否 | 抽查机关 |
| insDate | String | 20 | 否 | 抽查完成日期 |
| raninsPlanId | String | 255 | 否 | 抽查计划编号 |
| raninsPlaneName | String | 1000 | 否 | 抽查计划名称 |
| raninsTaskId | String | 255 | 否 | 抽查任务编号 |
| raninsTaskName | String | 1000 | 否 | 抽查任务名称 |
| raninsTypeName | String | 255 | 否 | 抽查类型 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "insAuth": "滁州市定远县市场监督管理局",
                "raninsTaskName": "2017年度全省不定向抽查（全省）",
                "insDate": "2017-10-30",
                "raninsPlanId": "34000020171000",
                "raninsPlaneName": "2017年度全省不定向抽查（全省）",
                "raninsTaskId": "340000201709041000",
                "details": "[{\"raninsCheckResName\":\"未发现问题\",\"seqno\":1,\"raninsItemName\":\"\"},{\"raninsCheckResName\":\"未发现问题\",\"seqno\":2,\"raninsItemName\":\"\"}]",
                "raninsTypeName": "不定向"
            }
        ],
        "totalCount": 2
    },
    "msg": "查询成功"
}

```
