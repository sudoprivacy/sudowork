# 行政许可

**分类:** 企业资质
**路径:** `POST /v1/company/industrial/license`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/license

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
  	"companyName": "南京开物科技发展有限公司",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 参数说明 |
| --- | --- | --- | --- | --- |
| content | String | 65535 | 否 | 许可内容 |
| department | String | 255 | 否 | 许可机关 |
| disabled | Integer | - | 否 | 状态：1注销，2正常，3有效，4无效，5撤销，6异议，7吊销，8变更，-1其他 |
| endDate | String | 20 | 否 | 结束日期 |
| name | String | 255 | 否 | 许可文件名称 |
| number | String | 255 | 否 | 许可文件编号 |
| startDate | String | 20 | 否 | 开始日期 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "number": "(01040099)公司变更[2016]第06170034号",
                "endDate": "2054-03-16",
                "name": "公司变更",
                "disabled": 1,
                "department": "南京市秦淮区市场监督管理局",
                "startDate": "2016-06-20",
                "content": "企业名称：南京开物科技发展有限公司"
            }
        ],
        "totalCount": 3
    },
    "msg": "查询成功"
}

```
