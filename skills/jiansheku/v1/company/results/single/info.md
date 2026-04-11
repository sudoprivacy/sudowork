# 四库备案业绩-单体信息

**分类:** 四库业绩
**路径:** `POST /v1/company/results/single/info`
**Content-Type:** `application/json`

四库备案业绩-单体信息

## 请求参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| pageIndex | number | 是 |  |
| pageSize | number | 是 |  |
| pid | string | 是 | 项目编号 |

## 响应参数 (Structured)

| 参数名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| code | number | 是 |  |
| data | array | 是 |  |
| buildArea | number | 是 | 建筑面积 |
| buildAreaBottom | string | 是 | 地下建筑面积 |
| buildAreaOn | string | 是 | 地上建筑面积 |
| buildHigh | number | 是 | 构筑物高度 |
| createTime | number | 是 |  |
| defenceBottomArea | number | 是 | 人防地下室面积 |
| earthquakeIntensity | string | 是 | 抗震设防烈度 |
| floorCountBottom | string | 是 | 地下层数 |
| floorCountOn | string | 是 | 地面层数 |
| greenLevel | string | 是 | 绿色建筑等级 |
| id | number | 是 |  |
| invest | number | 是 | 工程总造价 |
| isAssembling | number | 是 | 是否为装配式建筑  0否 1是 |
| isGreen | number | 是 | 是否绿色建筑：0否 1是 |
| isHistory | number | 是 | 是否为历史：0为非历史，1为历史 |
| isShockisolationBuilding | number | 是 | 是否为减隔震建筑：0否 1是 |
| isSuperHighBuild | number | 是 | 是否超限高层建筑：0否 1是 |
| md5Data | string | 是 |  |
| memo | string | 是 | 其他 |
| pid | string | 是 | 项目编号 |
| projectCode | string | 是 | 投资项目在线审批 监管平台统一编码 |
| projectLevel | string | 是 | 工程等级 |
| singleSpanConcreteLength | number | 是 | 单跨（钢筋混凝土结构）(米) |
| singleSpanHeavySteelLength | number | 是 | 单跨（重钢结构）(米) |
| skyId | number | 是 |  |
| structure | string | 是 | 结构体系 |
| subBuildHeight | number | 是 | 建筑高度 |
| subCensorNo | string | 是 | 施工图审查环节记录编号 |
| subLicenceNo | string | 是 | 施工许可环节编号 |
| subProjectLength | number | 是 | 长度 |
| subProjectName | string | 是 | 单体建（构）筑物名称 |
| subProjectSpan | number | 是 | 跨度 |
| subQualityNo | string | 是 | 质量监督记录编号 |
| subSafeNo | string | 是 | 安全监督记录编号 |
| subScale | string | 是 | 工程规模 |
| subTenderNo | string | 是 | 招标项目环节记录编号 |
| unitCode | string | 是 | 单体编码 |
| unitNumber | number | 是 | 住宅套数(户) |
| updateTime | number | 是 |  |
| msg | string | 是 |  |
