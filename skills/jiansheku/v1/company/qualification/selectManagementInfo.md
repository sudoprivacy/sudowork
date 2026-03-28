# 管理体系详情

**分类:** 荣誉奖项
**路径:** `POST /v1/company/qualification/selectManagementInfo`
**Content-Type:** `application/json`

### 字符编码
UTF-8

### 请求地址
/v1/company/qualification/selectManagementInfo

### 请求方式
POST(application/json)

### 请求参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | String | 20 | 是 | 管理体系id |


#### 请求示例

```
{
  "id":"c7867df3fa744dd99214c498102b43f8"
}

```

### 响应参数

| 参数名 | 类型 | 长度 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| id | String | 20 | 是 | 管理体系id |
| registerNo | String | 100 | 是 | 证书编号 |
| licenseName | String | 100 | 是 | 证书名称 |
| validStart | String | 20 | 是 | 颁证日期“yyyy-mm-dd” |
| validEnd | String | 20 | 是 | 证书到期日期 “yyyy-mm-dd” |
| firstDate | String | 20 | 是 | 初次获证日期 “yyyy-mm-dd” |
| shangbaoDate | String | 20 | 是 | 信息上报日期 “yyyy-mm-dd” |
| market | String | 255 | 是 | 证书使用的认可标识 |
| certificationBasis | String | 255 | 是 | 认证依据 |
| isMultiplace | String | 50 | 是 | 是否覆盖多场所 |
| monitoringTimes | String | 20 | 是 | 监督次数 |
| reCertificationTimes | String | 20 | 是 | 再认证次数 |
| fugaiScope | String | 65535 | 否 | 认证覆盖的业务范围 |
| organizationName | String | 100 | 是 | 获证组织/生产企业名称 |
| organizationNo | String | 50 | 是 | 获证组织统一社会信用代码/组织机构代码 |
| organizationArea | String | 100 | 是 | 获证组织所在国别和地区 |
| organizationPeople | String | 100 | 是 | 本证书体系覆盖人数 |
| organizationAddress | String | 255 | 是 | 获证组织地址 |
| agencyName | String | 255 | 是 | 发证机构名称 |
| agencyNo | String | 50 | 是 | 发证机构批准号 |
| agencyDate | String | 20 | 是 | 发证机构有效期 “yyyy-mm-dd” |
| agencyPhone | String | 100 | 是 | 发证机构电话 |
| agencyAddress | String | 255 | 是 | 发证机构地址 |
| agencyDomain | String | 255 | 是 | 发证机构网址 |
| agencyStatus | String | 50 | 是 | 发证机构状态 |
| agencyScope | String | 65535 | 否 | 发证结构业务范围 |


#### 返回结果示例

```
{
  "code": 200,
  "msg": "请求成功",
  "data": {
    "agencyDate": "2024-12-10",
    "registerNo": "00617S20665R5L",
    "monitoringTimes": "0",
    "organizationArea": "湖北",
    "firstDate": "2005-01-04",
    "fugaiScope": "各类工业与民用建筑的工程总承包及设计与施工、人防与地下空间工程设计与施工；路桥工程、公用工程施工总承包。",
    "agencyStatus": "有效",
    "id": "c7867df3fa744dd99214c498102b43f8",
    "reCertificationTimes": "6",
    "agencyDomain": "www.qac.com.cn",
    "organizationName": "中建三局集团有限公司",
    "organizationPeople": "4500",
    "validStart": "2017-09-01",
    "isMultiplace": "是",
    "organizationNo": "91420000757013137P",
    "licenseName": "职业健康安全管理体系认证",
    "agencyNo": "CNCA-R-2002-006",
    "agencyName": "中质协质量保证中心",
    "market": "CNAS",
    "certificationBasis": "GB/T28001-2011/OHSAS18001:2007",
    "agencyAddress": "三虎桥百胜村6号",
    "organizationAddress": "湖北省武汉市关山路552号(注册地址)；湖北省武汉市东湖高新区高新大道799号中建三局总部大楼17楼企划部(通讯地址)；湖北省武汉市东湖高新区高新大道799号(审核地址)",
    "shangbaoDate": "2019-08-06",
    "validEnd": "2020-08-31",
    "agencyScope": "管理体系认证-质量管理体系认证,管理体系认证-环境管理体系认证,管理体系认证-职业健康安全管理体系认证,管理体系认证-信息安全管理体系认证,管理体系认证-信息技术服务管理体系认证,服务认证-建筑工程和建筑物服务,服务认证-批发业和零售业服务,服务认证-住宿服务；食品和饮料服务,服务认证-电力分配服务；通过主要管道的燃气和水分分配服务,服务认证-不动产服务,服务认证-在收费或合同基础上的生产服务,国推认证-食品安全管理体系,国推认证-危害分析与关键控制点,国推认证-能源管理体系",
    "agencyPhone": "010-68416821"
  }
}

```
