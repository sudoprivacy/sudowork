# 股权冻结

**分类:** 经营风险
**路径:** `POST /v1/company/industrial/freezes`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/industrial/freezes

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
  	"companyName": "德州市润灜民间资本管理股份有限公司",
	"pageIndx":1,
	"pageSize":1
}

```

### 响应参数

| 参数名称 | 类型 | 长度 | 必填 | 参数说明 |
| --- | --- | --- | --- | --- |
| amount | String | 255 | 否 | 股权数额 |
| beExecutedPerson | String | 255 | 否 | 被执行人 |
| continueFreezeDetails | String | 65535 | 否 | 续行冻结详情 |
| detail | String | 65535 | 否 | 冻结详情 |
| detail.corp_name | String | 255 | 否 | 冻结详情中的关联企业名称 |
| detail.public_date | String | 255 | 否 | 冻结详情中的公示日期 |
| detail.assist_name | String | 255 | 否 | 冻结详情中的被执行人 |
| detail.freeze_amount | String | 255 | 否 | 冻结详情中的被执行人持有股权、其它投资权益的数额 |
| detail.assist_ident_type | String | 255 | 否 | 冻结详情中的被执行人证件种类 |
| detail.freeze_year_month | String | 255 | 否 | 冻结详情中的冻结期限 |
| detail.freeze_start_date | String | 255 | 否 | 冻结详情中的冻结开始时间 |
| detail.freeze_end_date | String | 255 | 否 | 冻结详情中的冻结结束时间 |
| detail.notice_no | String | 255 | 否 | 冻结详情中的执行通知文书号 |
| detail.assist_item | String | 255 | 否 | 冻结详情中的执行事项 |
| detail.eid | String | 255 | 否 | 冻结详情中的被执行人eid |
| detail.assist_ident_no | String | 255 | 否 | 冻结详情中的被执行企业证照号 |
| detail.execute_court | String | 255 | 否 | 冻结详情中的执行法院 |
| detail.adjudicate_no | String | 255 | 否 | 冻结详情中的执行裁定文书号 |
| executiveCourt | String | 255 | 否 | 执行法院 |
| loseEfficacyDate | String | 255 | 否 | 失效时间 |
| loseEfficacyReason | String | 255 | 否 | 失效原因 |
| number | String | 255 | 否 | 执行通知书文号 |
| pcFreezeDetail | String | 65535 | 否 | 股东变更登记情况 |
| status | String | 255 | 否 | 状态 |
| type | String | 255 | 否 | 类型 |
| unFreezeDetails | String | 65535 | 否 | 股权冻结-解冻详情 |
| totalCount | Integer | - | 是 | 总条数 |


#### 返回结果示例

```
{
    "code": 200,
    "data": {
        "list": [
            {
                "amount": "4500万人民币",
                "beExecutedPerson": "武城县兴宏物流仓储有限公司",
                "continueFreezeDetails": "[]",
                "detail": "{\"assist_name\":\"武城县兴宏物流仓储有限公司\",\"execute_court\":\"山东省武城县人民法院\",\"adjudicate_no\":\"（2018）鲁1428财保47号\",\"freeze_amount\":\"4500万\",\"assist_ident_no\":\"****\",\"freeze_start_date\":\"2018-08-08\",\"assist_ident_type\":\"企业法人营业执照(公司)\",\"freeze_end_date\":\"2020-08-08\",\"public_date\":\"2018-08-08\",\"assist_item\":\"公示冻结股权、其他投资权益\",\"eid\":\"9fab5104-9ae1-4988-aa9a-c275d2fdcf38\",\"corp_name\":\"\",\"notice_no\":\"（2018）鲁1428财保47号之一\",\"freeze_year_month\":\"731天\"}",
                "detailFreezeEndDate": "2020-08-08",
                "detailFreezeStartDate": "2018-08-08",
                "executiveCourt": "山东省武城县人民法院",
                "loseEfficacyDate": "",
                "loseEfficacyReason": "",
                "number": "（2018）鲁1428财保47号之一",
                "pcFreezeDetail": "{\"assist_ident_no\":\"\",\"assignee_ident_no\":\"\",\"freeze_amount\":\"\",\"assignee_ident_type\":\"\",\"assignee\":\"\",\"aid\":\"\",\"adjudicate_no\":\"\",\"notice_no\":\"\",\"assist_item\":\"\",\"execute_court\":\"\",\"eid\":\"\",\"assist_name\":\"\",\"assist_ident_type\":\"\",\"xz_execute_date\":\"\"}",
                "status": "股权冻结|冻结",
                "type": "股权冻结",
                "unFreezeDetails": "[]"
            }
        ],
        "totalCount": 6
    },
    "msg": "查询成功"
}

```
