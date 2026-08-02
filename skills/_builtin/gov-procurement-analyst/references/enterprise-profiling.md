# 企业画像构建与匹配算法参考

## 一、企业画像数据模型

### 1.1 核心数据字段

```python
class EnterpriseProfile:
    """政府采购供应商企业画像"""
    
    # === 基础信息（必填） ===
    name: str                           # 企业名称（全称）
    credit_code: str                    # 统一社会信用代码（18位）
    legal_representative: str           # 法人代表
    reg_capital: float                  # 注册资本（万元）
    reg_date: str                       # 注册日期
    reg_authority: str                  # 登记机关
    address: str                        # 注册地址
    biz_scope: str                      # 经营范围
    
    # === 能力画像（必填） ===
    industry: str                       # 主营行业（分类码）
    industry_tags: list                 # 行业标签（多选）
    certs: list                         # 资质证书清单
    main_products: list                 # 主营产品/服务
    
    # === 经营画像（选填） ===
    enterprise_scale: str               # 企业规模（大/中/小/微）
    employee_count: int                 # 员工人数
    annual_revenue: float               # 近一年营业额（万元）
    
    # === 投标画像（选填） ===
    total_bid_count: int = 0            # 累计投标次数
    total_win_count: int = 0            # 累计中标次数
    total_win_amount: float = 0.0       # 累计中标金额（万元）
    avg_bid_amount: float = 0.0         # 平均投标金额（万元）
    history_projects: list              # 历史项目经验
    preferred_provinces: list           # 优势地区
    
    # === 风险维度 ===
    is_abnormal: bool = False           # 经营异常名录
    is_illegal: bool = False            # 严重违法失信
    tax_grade: str = ""                 # 纳税信用等级（A/B/C/D/M）
    social_insurance: bool = True       # 社保缴纳正常
```

### 1.2 数据采集规则

| 字段 | 来源 | 优先级 | 采集方式 |
|------|------|--------|----------|
| 企业名称 | 用户提供 | P0 | 用户输入 |
| 统一社会信用代码 | 用户提供 / 企查查 | P0 | 用户输入 |
| 主营行业 | 用户提供 / 公示系统 | P0 | 用户输入 |
| 注册地址 | 公示系统 | P1 | browser skill |
| 资格证书 | 用户提供 | P0 | 用户输入 |
| 历史业绩 | 用户提供 / 中标公告 | P1 | browser skill |
| 经营异常 | 公示系统 / 信用中国 | P2 | browser skill |
| 诉讼记录 | 裁判文书网 | P2 | browser skill |
| 行政处罚 | 信用中国 | P2 | browser skill |

## 二、匹配算法详解

### 2.1 行业匹配（权重30%）

**规则**：使用《政府采购品目分类目录》进行匹配

```python
def match_industry(project_category: str, enterprise_industries: list) -> float:
    """
    行业匹配度计算
    返回: 0.0 ~ 1.0
    
    完全匹配 → 1.0
    一级分类相同（如都是"A货物"） → 0.8
    二级分类相同（如都是"A02 办公设备"） → 0.9
    跨行业但相关 → 0.5
    完全不相关 → 0.0
    """
    # 品目编码树结构
    CATEGORY_TREE = {
        'A': {'name': '货物', 'weight': 1.0, 'children': {
            'A01': {'name': '土地、房屋及构筑物', 'weight': 0.9},
            'A02': {'name': '通用设备', 'weight': 0.9},
            'A03': {'name': '专用设备', 'weight': 0.9},
            'A04': {'name': '文物和陈列品', 'weight': 0.9},
            'A05': {'name': '图书和档案', 'weight': 0.9},
            'A06': {'name': '家具、用具、装具及动植物', 'weight': 0.9},
            'A07': {'name': '纺织原料、毛皮、被服装具', 'weight': 0.9},
            'A08': {'name': '纸、纸制品及印刷品', 'weight': 0.9},
            'A09': {'name': '食品、饮料和农副产品', 'weight': 0.9},
            'A10': {'name': '药物、医疗器材及医用耗材', 'weight': 0.9},
            'A11': {'name': '物资', 'weight': 0.9},
            # ... 完整品目见 references/category-codes.md
        }},
        'B': {'name': '工程', 'weight': 1.0, 'children': {
            'B01': {'name': '房屋建筑业', 'weight': 0.9},
            'B02': {'name': '土木工程建筑业', 'weight': 0.9},
            'B03': {'name': '建筑安装业', 'weight': 0.9},
            'B04': {'name': '建筑装饰、装修和其他建筑业', 'weight': 0.9},
        }},
        'C': {'name': '服务', 'weight': 1.0, 'children': {
            'C01': {'name': '科学研究和技术服务', 'weight': 0.9},
            'C02': {'name': '交通运输和仓储服务', 'weight': 0.9},
            'C03': {'name': '批发和零售服务', 'weight': 0.9},
            'C04': {'name': '住宿和餐饮服务', 'weight': 0.9},
            'C05': {'name': '信息技术服务', 'weight': 0.9},
            'C06': {'name': '租赁和商务服务', 'weight': 0.9},
            'C07': {'name': '会议、展览及相关服务', 'weight': 0.9},
            'C08': {'name': '专业咨询服务', 'weight': 0.9},
            'C09': {'name': '水利、环境和公共设施管理服务', 'weight': 0.9},
            'C10': {'name': '居民服务和其他服务', 'weight': 0.9},
            'C11': {'name': '教育服务', 'weight': 0.9},
            'C12': {'name': '医疗卫生服务', 'weight': 0.9},
            'C13': {'name': '社会保障服务', 'weight': 0.9},
            'C14': {'name': '社会福利服务', 'weight': 0.9},
            'C15': {'name': '文化、体育和娱乐服务', 'weight': 0.9},
            'C16': {'name': '金融服务', 'weight': 0.9},
            'C17': {'name': '农、林、牧、渔服务', 'weight': 0.9},
            'C18': {'name': '市政公用设施管理服务', 'weight': 0.9},
            'C19': {'name': '供电、供水、供气服务', 'weight': 0.9},
            'C20': {'name': '住宿和餐饮服务', 'weight': 0.9},
            'C21': {'name': '电信和其他传输服务', 'weight': 0.9},
            'C22': {'name': '金融和保险服务', 'weight': 0.9},
            'C23': {'name': '审计和咨询服务', 'weight': 0.9},
            # 完整品目以最新版《政府采购品目分类目录》为准
        }},
    }
    
    # 精确匹配
    for industry in enterprise_industries:
        if industry == project_category:
            return 1.0
    
    # 分类匹配
    project_prefix = project_category[:3] if len(project_category) >= 3 else project_category
    for industry in enterprise_industries:
        if industry[:3] == project_prefix:
            return 0.8
    
    # 顶级匹配
    if project_category[0] == enterprise_industries[0][0] if enterprise_industries else '':
        return 0.5
    
    return 0.0
```

### 2.2 资质匹配（权重25%）

```python
def match_certifications(required_certs: list, owned_certs: list) -> float:
    """
    资质匹配度
    
    计算方式：交集数量 / 要求数量
    特殊处理：
    - 营业执照/法人证书（默认具备，不计入要求）
    - 资质证书过期的视为不匹配
    ```
    
    if not required_certs:
        return 1.0  # 无资质要求 → 全部满足
    
    matched = 0
    for req in required_certs:
        for owned in owned_certs:
            if cert_matches(req, owned):
                matched += 1
                break
    
    return matched / len(required_certs)
```

### 2.3 业绩匹配（权重20%）

```python
def match_performance(project_description: str, history_projects: list) -> float:
    """
    业绩匹配度
    
    计算方式：
    - 同类型项目 ≥3个 → 1.0
    - 2个 → 0.7
    - 1个 → 0.4
    - 0个但有相关经验 → 0.2
    - 完全无经验 → 0.1
    """
    if not history_projects:
        return 0.1
    
    similar_count = 0
    for project in history_projects:
        similarity = calculate_similarity(project_description, project['description'])
        if similarity > 0.6:  # 相似度阈值
            similar_count += 1
    
    if similar_count >= 3:
        return 1.0
    elif similar_count == 2:
        return 0.7
    elif similar_count == 1:
        return 0.4
    else:
        return 0.2
```

### 2.4 地区便利性（权重15%）

```python
def calculate_location_score(project_location: str, enterprise_location: str) -> float:
    """
    地区便利性评分
    
    完全匹配 → 1.0
    同省不同市 → 0.8
    相邻省份 → 0.5
    跨省远距离 → 0.3
    """
    if project_location == enterprise_location:
        return 1.0
    
    if project_location[:2] == enterprise_location[:2]:
        return 0.8
    
    # 相邻省份判断（简化版）
    ADJACENT_PROVINCES = {
        '北京': ['河北', '天津'],
        '天津': ['北京', '河北'],
        '河北': ['北京', '天津', '山东', '河南', '山西', '内蒙古', '辽宁'],
        '山西': ['河北', '河南', '陕西', '内蒙古'],
        '内蒙古': ['山西', '陕西', '宁夏', '甘肃', '黑龙江', '吉林', '辽宁', '河北'],
        '辽宁': ['河北', '内蒙古', '吉林'],
        '吉林': ['辽宁', '内蒙古', '黑龙江'],
        '黑龙江': ['吉林', '内蒙古'],
        '上海': ['江苏', '浙江'],
        '江苏': ['上海', '浙江', '安徽', '山东'],
        '浙江': ['上海', '江苏', '安徽', '江西', '福建'],
        '安徽': ['江苏', '浙江', '江西', '湖北', '河南', '山东'],
        '福建': ['浙江', '江西', '广东'],
        '江西': ['安徽', '浙江', '福建', '广东', '湖南', '湖北'],
        '山东': ['河北', '河南', '江苏', '安徽'],
        '河南': ['河北', '山西', '陕西', '湖北', '安徽', '山东'],
        '湖北': ['河南', '安徽', '江西', '湖南', '重庆', '陕西'],
        '湖南': ['湖北', '江西', '广东', '广西', '贵州', '重庆'],
        '广东': ['福建', '江西', '湖南', '广西', '海南'],
        '广西': ['广东', '湖南', '贵州', '云南'],
        '海南': ['广东'],
        '重庆': ['四川', '贵州', '湖北', '陕西', '湖南'],
        '四川': ['重庆', '贵州', '云南', '西藏', '陕西', '甘肃', '青海'],
        '贵州': ['四川', '重庆', '湖南', '广西', '云南'],
        '云南': ['四川', '贵州', '广西', '西藏'],
        '西藏': ['四川', '云南', '青海', '新疆'],
        '陕西': ['内蒙古', '宁夏', '甘肃', '四川', '重庆', '湖北', '河南', '山西'],
        '甘肃': ['内蒙古', '宁夏', '陕西', '四川', '青海', '新疆'],
        '青海': ['甘肃', '四川', '西藏', '新疆'],
        '宁夏': ['内蒙古', '陕西', '甘肃'],
        '新疆': ['甘肃', '青海', '西藏'],
    }
    
    project_province = project_location[:2]  # 简化的省份提取
    enterprise_province = enterprise_location[:2]
    
    if project_province in ADJACENT_PROVINCES.get(enterprise_province, []):
        return 0.5
    
    return 0.3
```

### 2.5 金额匹配（权重10%）

```python
def calculate_amount_match(project_budget: float, avg_bid_amount: float) -> float:
    """
    金额匹配度
    
    完全匹配 → 1.0
    在 ±50% 范围内 → 0.8
    超出范围但量级相当 → 0.5
    量级差异大 → 0.2
    """
    if avg_bid_amount == 0:
        return 0.5  # 无历史数据 → 中性分
    
    ratio = project_budget / avg_bid_amount
    
    if 0.5 <= ratio <= 2.0:
        return 1.0
    elif 0.3 <= ratio <= 3.0:
        return 0.6
    else:
        return 0.2
```

## 三、报价策略模型

### 3.1 最低价法

```python
def lowest_price_strategy(budget: float, historical_discounts: list, enterprise_cost: float):
    """
    最低评标价法建议
    
    策略：在成本基础上，比历史平均下浮比例略低一点
    """
    avg_discount = sum(historical_discounts) / len(historical_discounts)
    suggested_price = budget * (1 - avg_discount * 0.95)
    
    # 确保不低于成本
    if suggested_price < enterprise_cost:
        suggested_price = enterprise_cost * 1.05  # 成本 + 最低利润
    
    return {
        'suggested_range': (suggested_price * 0.97, suggested_price),
        'estimated_cost': enterprise_cost,
        'profit_margin': (suggested_price - enterprise_cost) / suggested_price,
        'rationale': f'历史中标价平均下浮{avg_discount*100:.1f}%，建议略低于平均（avg_discount*0.95）'
    }
```

### 3.2 综合评分法

```python
def comprehensive_scoring_strategy(budget: float, price_score_formula: str, 
                                     competitor_prices: list, tech_score_estimate: float):
    """
    综合评分法建议
    
    解析价格分计算公式 + 模拟竞对报价 → 找出最优区间
    """
    # 价格分公式通常形如：
    # 价格分 = (评标基准价 / 报价) × 权重
    # 最低价法基准价：满足要求的最低报价
    
    # 简化模拟：假设报价在中位数附近时价格分最优
    median_price = sorted(competitor_prices)[len(competitor_prices) // 2]
    min_price = min(competitor_prices)
    
    # 计算技术分优势可弥补的价格分劣势
    tech_advantage = tech_score_estimate - 70  # 以平均分70为基准
    
    # 如果技术分有优势，可以适当报高价
    if tech_advantage > 0:
        suggested = median_price * (1 + tech_advantage * 0.002)
    else:
        suggested = min_price * 1.02  # 略高于最低价
    
    return {
        'suggested_range': (suggested * 0.98, suggested * 1.01),
        'rationale': f'基于{len(competitor_prices)}家竞对历史报价，中位数¥{median_price}万',
        'competitor_prices': competitor_prices
    }
```

## 四、风险规则库

### 4.1 围标串标检测规则

| 规则编号 | 规则名称 | 检测逻辑 | 风险等级 |
|----------|----------|----------|----------|
| R001 | 联系方式雷同 | 不同投标人联系电话/邮箱/地址相同 | 🔴 高 |
| R002 | MAC 地址相同 | 投标文件上传设备相同 | 🔴 高 |
| R003 | 文件相似度 | 投标文件异常相似（技术方案内容雷同） | 🔴 高 |
| R004 | 关联企业投标 | 同一控制人/关联企业参加同一标段 | 🔴 高 |
| R005 | 报价规律性 | 多家投标人报价呈等差/等比数列 | 🟡 中 |
| R006 | 投标代表同一人 | 投标授权委托书代表为同一人 | 🔴 高 |
| R007 | 同一 IP 下载 | 多个投标人同一 IP 下载招标文件 | 🟡 中 |
| R008 | 混装包装 | 不同投标人文件混装或邮寄地址相同 | 🔴 高 |

### 4.2 时间节点合规检查

| 节点 | 法规要求 | 检查逻辑 |
|------|----------|----------|
| 招标文件发售期 | ≥5 日 | 发售开始到首次发售间隔 ≥5 天 |
| 提交投标文件截止 | 自招标文件发出起 ≥20 日 | 发售开始到投标截止 ≥20 天 |
| 澄清修改时限 | 提交截止 ≥15 日前 | 澄清发布日期到投标截止 ≥15 天 |
| 中标公示期 | ≥1 日（货物/服务）或 ≥3 日（工程） | 公示时间符合要求 |
| 合同签订 | 中标通知书发出后 ≤30 日 | 签订合同日期 - 中标通知日期 ≤30 |

以上法规依据：《中华人民共和国政府采购法》及其实施条例、《中华人民共和国招标投标法》及其实施条例。

---

*本参考文档用于指导 Skill 中的企业画像构建和匹配算法实现。*
*实际计算时根据项目情况可微调系数，需充分测试验证准确性。*