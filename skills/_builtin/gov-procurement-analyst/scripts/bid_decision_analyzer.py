"""
投标决策分析器

根据企业画像、竞争对手历史、评分方法，输出明确的决策建议。

使用方式：
  python bid_decision_analyzer.py --project "project.json" --enterprise "company.json" --competitors "competitors.json"
"""

import argparse
import json
import os
from datetime import datetime
from typing import Optional


# === 报价策略模型 ===

def lowest_price_strategy(budget: float, historical_discounts: list, cost: float) -> dict:
    """
    最低评标价法
    
    策略：比历史平均下浮比例略低（乘数 0.95），确保不低于成本
    """
    if not historical_discounts:
        return {
            'method': '最低评标价法（无历史数据）',
            'suggested_range': (budget * 0.85, budget * 0.90),
            'estimated_cost': cost,
            'profit_margin': 0.10,
            'rationale': '无历史中标数据参考，建议保守报价（预算的 85%~90%）',
        }
    
    avg_discount = sum(historical_discounts) / len(historical_discounts)
    suggested = budget * (1 - avg_discount * 0.95)
    
    # 不低于成本
    if suggested < cost * 1.05:
        suggested = cost * 1.05
    
    return {
        'method': '最低评标价法',
        'suggested_range': (round(suggested * 0.97, 2), round(suggested, 2)),
        'estimated_cost': round(cost, 2),
        'profit_margin': round((suggested - cost) / max(suggested, 1), 4),
        'rationale': (
            f'历史中标价平均下浮 {avg_discount*100:.1f}%，'
            f'建议报价略低于平均（{avg_discount*0.95*100:.1f}%），'
            f'最低不低于成本线 ¥{cost}万'
        ),
    }


def comprehensive_scoring_strategy(budget: float, competitor_prices: list, 
                                     tech_score: float = 70) -> dict:
    """
    综合评分法
    
    解析价格分计算公式 + 模拟竞对 → 找出最优区间
    """
    if not competitor_prices:
        return {
            'method': '综合评分法（无竞对数据）',
            'suggested_range': (budget * 0.80, budget * 0.85),
            'estimated_cost': 0,
            'profit_margin': 0.15,
            'rationale': '无竞对历史报价数据，建议预算的80%~85%（保守策略）',
        }
    
    sorted_prices = sorted(competitor_prices)
    median_price = sorted_prices[len(sorted_prices) // 2]
    lowest_price = sorted_prices[0]
    q1 = sorted_prices[len(sorted_prices) // 4]
    
    # 技术分优势 → 可以适当报高价
    tech_advantage = tech_score - 70  # 以70分为基准
    
    if tech_advantage > 10:
        # 明显技术优势 → 可以报中高价
        suggested = median_price * 1.05
        rationale = f'技术分预估 {tech_score} 分（有明显优势），建议报价略高于中位数'
    elif tech_advantage > 0:
        # 略有技术优势 → 报中位数
        suggested = median_price
        rationale = f'技术分预估 {tech_score} 分（略有优势），建议围绕中位数报价'
    else:
        # 无明显技术优势 → 报中低价
        suggested = q1
        rationale = f'技术分预估 {tech_score} 分（无明显优势），建议竞争中低价'
    
    return {
        'method': '综合评分法',
        'suggested_range': (round(suggested * 0.98, 2), round(suggested * 1.02, 2)),
        'estimated_cost': 0,
        'profit_margin': 0.12,
        'rationale': rationale,
        'competitor_median': median_price,
        'competitor_lowest': lowest_price,
    }


# === SWOT 生成 ===

def generate_swot(enterprise: dict, project: dict, competitors: list) -> dict:
    """基于企业画像和项目信息生成 SWOT"""
    strengths = []
    weaknesses = []
    opportunities = []
    threats = []
    
    # 优势分析
    if enterprise.get('certifications'):
        strengths.append(f"具备 {len(enterprise['certifications'])} 项资质证书")
    
    if enterprise.get('history_projects'):
        similar = len([p for p in enterprise['history_projects'] 
                       if project.get('category', '') in p.get('category', '')])
        if similar >= 3:
            strengths.append(f"同类型项目经验丰富（{similar}个业绩）")
        elif similar >= 1:
            strengths.append(f"有类似项目经验（{similar}个业绩）")
    
    location = enterprise.get('location', '')
    if location and project.get('location', '') == location:
        strengths.append(f"本地企业，售后服务和应急响应优势明显")
    
    if enterprise.get('win_rate', 0) > 0.5:
        strengths.append(f"历史中标率较高（{enterprise['win_rate']*100:.0f}%）")
    
    # 劣势分析
    missing_certs = set(project.get('required_certifications', [])) - set(enterprise.get('certifications', []))
    if missing_certs:
        weak_certs = [c for c in missing_certs if '营业执照' not in c]
        if weak_certs:
            weaknesses.append(f"缺少资质：{', '.join(weak_certs[:3])}")
    
    if not enterprise.get('history_projects'):
        weaknesses.append("无历史项目业绩记录（首次投标该领域）")
    
    avg_amount = enterprise.get('avg_bid_amount', 0)
    budget = project.get('budget', 0)
    if avg_amount and budget > avg_amount * 3:
        weaknesses.append(f"项目金额（¥{budget}万）远超企业历史平均（¥{avg_amount}万），可能经验不足")
    
    if location and project.get('location', '') != location:
        if project.get('location', '')[:2] != location[:2]:
            weaknesses.append(f"跨区域投标，当地资源和关系网络可能不足")
    
    # 机会分析
    if project.get('method') == '公开招标':
        opportunities.append("公开招标方式，信息透明，可充分了解竞争对手")
    
    project_industry = project.get('category', '')
    if project_industry:
        opportunities.append(f"该项目属于 {project_industry} 领域，与企业发展方向一致")
    
    if not competitors:
        opportunities.append("未发现明显强力竞争对手，中标机会较大")
    
    # 威胁分析
    if competitors:
        strong_competitors = [c for c in competitors if c.get('win_rate', 0) > 0.6]
        if strong_competitors:
            names = '、'.join([c.get('name', '') for c in strong_competitors[:2]])
            threats.append(f"存在强力竞对：{names}（历史中标率高）")
        
        if len(competitors) >= 5:
            threats.append(f"竞争激烈（{len(competitors)}家已知竞对）")
    
    return {
        'strengths': strengths if strengths else ['企业资质齐全，具备投标基础条件'],
        'weaknesses': weaknesses if weaknesses else ['暂无明显劣势（需进一步核实）'],
        'opportunities': opportunities if opportunities else ['项目机会正常'],
        'threats': threats if threats else ['暂未发现明显威胁'],
    }


# === 决策引擎 ===

class BidDecisionEngine:
    """投标决策分析引擎"""
    
    def __init__(self, project: dict, enterprise: dict, competitors: list = None):
        self.project = project
        self.enterprise = enterprise
        self.competitors = competitors or []
    
    def analyze(self) -> dict:
        """执行完整分析，输出决策报告"""
        
        # 1. 资质符合性检查
        qualification = self._check_qualifications()
        
        # 2. 竞争对手分析
        competitor_analysis = self._analyze_competitors()
        
        # 3. 报价策略
        price_strategy = self._calculate_price_strategy()
        
        # 4. SWOT 分析
        swot = generate_swot(self.enterprise, self.project, self.competitors)
        
        # 5. 综合评分
        overall_score = self._calculate_overall_score(qualification, competitor_analysis)
        
        # 6. 决策结论
        recommendation = self._make_decision(overall_score, qualification, competitor_analysis)
        
        # 7. 关键动作
        key_actions = self._generate_key_actions(recommendation, qualification, competitor_analysis)
        
        return {
            'project': {
                'id': self.project.get('id', ''),
                'name': self.project.get('title', self.project.get('project_name', '')),
                'purchaser': self.project.get('purchaser', ''),
                'budget': self.project.get('budget', 0),
                'bid_deadline': self.project.get('bid_deadline', ''),
                'evaluation_method': self.project.get('evaluation_method', ''),
            },
            'enterprise': self.enterprise.get('name', ''),
            'qualification': qualification,
            'competitor_analysis': competitor_analysis,
            'price_strategy': price_strategy,
            'swot': swot,
            'overall_score': round(overall_score, 1),
            'recommendation': recommendation['level'],
            'confidence': recommendation['confidence'],
            'risk_level': recommendation['risk_level'],
            'key_actions': key_actions,
            'risk_mitigation': recommendation.get('mitigations', []),
            'conclusion': recommendation['conclusion'],
            'disclaimer': '本报告基于公开数据和统计模型，仅供参考，不构成法律或投资建议。',
        }
    
    def _check_qualifications(self) -> dict:
        """资质符合性检查"""
        required = set(self.project.get('required_certifications', []))
        owned = set(self.enterprise.get('certifications', []))
        
        matched = required & owned
        missing = required - owned
        # 自动满足的资质
        auto_satisfied = {'营业执照', '法人证书', '身份证明', '税务登记'}
        
        real_missing = missing - auto_satisfied
        
        compliance_rate = len(matched) / max(len(required), 1)
        
        # 一票否决项
        fatal_items = []
        for item in real_missing:
            if any(k in item for k in ['许可证', '资质', '认证', '资格']):
                fatal_items.append(item)
        
        return {
            'required_count': len(required),
            'matched_count': len(matched),
            'missing_count': len(real_missing),
            'compliance_rate': round(compliance_rate, 2),
            'missing_items': list(real_missing)[:5],
            'fatal_missing': fatal_items[:3],
        }
    
    def _analyze_competitors(self) -> list:
        """分析竞争对手"""
        results = []
        
        for comp in self.competitors:
            results.append({
                'name': comp.get('name', ''),
                'win_rate': f"{comp.get('win_rate', 0)*100:.0f}%",
                'bid_count': comp.get('total_bids', 0),
                'avg_price': comp.get('avg_bid_price', ''),
                'advantages': comp.get('advantages', ['历史中标率高'])[:3],
            })
        
        # 按历史中标率排序
        results.sort(key=lambda x: float(x['win_rate'].replace('%', '')), reverse=True)
        
        return results
    
    def _calculate_price_strategy(self) -> dict:
        """计算报价策略"""
        method = self.project.get('evaluation_method', '')
        budget = self.project.get('budget', 0)
        cost = self.enterprise.get('estimate_cost', budget * 0.7)  # 默认估算
        
        # 获取竞对历史报价
        comp_prices = []
        for c in self.competitors:
            if c.get('avg_bid_price'):
                try:
                    comp_prices.append(float(c['avg_bid_price']))
                except (ValueError, TypeError):
                    pass
        
        # 获取历史下浮比例
        historical_discounts = self.enterprise.get('historical_discounts', [])
        
        if '最低价' in method or '最低' in method:
            return lowest_price_strategy(budget, historical_discounts, cost)
        else:
            return comprehensive_scoring_strategy(budget, comp_prices, self.enterprise.get('tech_score', 70))
    
    def _calculate_overall_score(self, qualification: dict, competitor_analysis: list) -> float:
        """计算综合得分（满分 100）"""
        score = 0
        
        # 资质符合度（30分）
        score += qualification['compliance_rate'] * 30
        
        # 经验匹配（20分）
        history = self.enterprise.get('history_projects', [])
        similar_count = len([p for p in history 
                            if self.project.get('category', '') in p.get('category', '')])
        score += min(similar_count / 3, 1.0) * 20
        
        # 地区便利（15分）
        if self.project.get('location', '') == self.enterprise.get('location', ''):
            score += 15
        elif self.project.get('location', '')[:2] == self.enterprise.get('location', '')[:2]:
            score += 12
        else:
            score += 6
        
        # 金额匹配（10分）
        avg = self.enterprise.get('avg_bid_amount', 0)
        budget = self.project.get('budget', 0)
        if avg > 0 and budget > 0:
            ratio = budget / avg
            if 0.5 <= ratio <= 1.5:
                score += 10
            elif 0.3 <= ratio <= 2.0:
                score += 7
            else:
                score += 3
        
        # 竞对压力（15分）- 竞对越弱分越高
        strong_competitors = sum(1 for c in self.competitors if c.get('win_rate', 0) > 0.6)
        if strong_competitors == 0:
            score += 15
        elif strong_competitors <= 2:
            score += 10
        elif strong_competitors <= 4:
            score += 5
        else:
            score += 2
        
        # 合规加分（10分）
        if not self.enterprise.get('is_abnormal') and not self.enterprise.get('is_illegal'):
            score += 10
        elif not self.enterprise.get('is_illegal'):
            score += 5
        
        return min(score, 100)
    
    def _make_decision(self, score: float, qualification: dict, competitor_analysis: list) -> dict:
        """做出决策"""
        result = {}
        
        # 决策等级
        fatal_missing = qualification.get('fatal_missing', [])
        
        if fatal_missing:
            result['level'] = '不建议'
            result['conclusion'] = f"存在必须满足的资质缺失（{'、'.join(fatal_missing)}），建议先补齐资质再考虑此类项目。"
        elif score >= 80:
            result['level'] = '强烈建议'
            result['conclusion'] = f"综合得分 {score} 分，具备明显竞争优势，强烈建议投标。"
        elif score >= 65:
            result['level'] = '建议'
            result['conclusion'] = f"综合得分 {score} 分，竞争优势良好，建议正常参与投标。"
        elif score >= 50:
            result['level'] = '谨慎'
            result['conclusion'] = f"综合得分 {score} 分，有一定机会但需审慎。建议在投入前补强短板。"
        else:
            result['level'] = '不建议'
            result['conclusion'] = f"综合得分 {score} 分，中标概率较低。如无特殊战略考虑，建议将资源投向更匹配的项目。"
        
        # 置信度
        data_completeness = sum([
            1 if self.enterprise.get('certifications') else 0,
            1 if self.enterprise.get('history_projects') else 0,
            1 if self.enterprise.get('location') else 0,
            1 if self.enterprise.get('avg_bid_amount') else 0,
        ])
        
        if data_completeness >= 3:
            result['confidence'] = '高'
        elif data_completeness >= 2:
            result['confidence'] = '中'
        else:
            result['confidence'] = '低'
        
        # 风险等级
        strong_count = sum(1 for c in competitor_analysis 
                          if float(c.get('win_rate', '0%').replace('%', '')) > 60)
        
        if strong_count >= 3 or len(fatal_missing) > 0:
            result['risk_level'] = '高'
        elif strong_count >= 1:
            result['risk_level'] = '中'
        else:
            result['risk_level'] = '低'
        
        # 风险应对
        result['mitigations'] = self._generate_mitigations(result, qualification, competitor_analysis)
        
        return result
    
    def _generate_mitigations(self, recommendation: dict, qualification: dict, 
                               competitor_analysis: list) -> list:
        """生成风险应对建议"""
        mitigations = []
        
        if qualification.get('missing_items'):
            mitigations.append(f"补齐缺失资质：{', '.join(qualification['missing_items'][:3])}")
        
        if recommendation['risk_level'] == '高':
            mitigations.append("深入分析竞对报价规律，制定差异化策略")
            mitigations.append("考虑与本地企业联合体投标，弥补地区劣势")
        
        if not self.enterprise.get('history_projects'):
            mitigations.append("准备充分的业绩证明材料，突出技术实力")
        
        if not mitigations:
            mitigations.append("正常准备投标文件，注意细节和时效")
        
        return mitigations
    
    def _generate_key_actions(self, recommendation: dict, qualification: dict, 
                               competitor_analysis: list) -> list:
        """生成关键动作清单"""
        actions = []
        
        if qualification.get('missing_items'):
            actions.append(f"⏰ 立即办理缺失资质（{', '.join(qualification['missing_items'][:2])}）")
        
        actions.append("📋 下载招标文件，逐条分析评分标准")
        actions.append("📊 收集竞对历史中标数据，分析报价规律")
        actions.append("💰 根据报价策略模型计算最优报价区间")
        actions.append("📝 启动技术方案编制，突出差异化优势")
        actions.append("✅ 投标前逐项自检评分达标情况")
        
        return actions


def main():
    parser = argparse.ArgumentParser(description='投标决策分析器')
    parser.add_argument('--project', required=True, help='项目 JSON 文件')
    parser.add_argument('--enterprise', required=True, help='企业画像 JSON 文件')
    parser.add_argument('--competitors', help='竞争对手 JSON 文件（可选）')
    parser.add_argument('--output', default='bid_decision.json', help='输出结果文件')
    parser.add_argument('--report', default='bid_decision_report.md', help='输出 Markdown 报告')
    
    args = parser.parse_args()
    
    # 加载数据
    with open(args.project, 'r', encoding='utf-8') as f:
        project = json.load(f)
    
    with open(args.enterprise, 'r', encoding='utf-8') as f:
        enterprise = json.load(f)
    
    competitors = []
    if args.competitors:
        with open(args.competitors, 'r', encoding='utf-8') as f:
            competitors = json.load(f)
    
    # 执行分析
    engine = BidDecisionEngine(project, enterprise, competitors)
    result = engine.analyze()
    
    # 保存结果
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"\n决策分析完成")
    print(f"综合得分：{result['overall_score']}")
    print(f"决策结论：{result['recommendation']}")
    print(f"置信度：{result['confidence']}")
    print(f"风险等级：{result['risk_level']}")
    print(f"\n结果已保存：{os.path.abspath(args.output)}")
    
    # 生成 Markdown 报告
    report = generate_markdown_report(result)
    with open(args.report, 'w', encoding='utf-8') as f:
        f.write(report)
    
    print(f"报告已保存：{os.path.abspath(args.report)}")
    
    return result


def generate_markdown_report(result: dict) -> str:
    """生成 Markdown 格式的决策报告"""
    lines = []
    
    lines.append("# 投标决策分析报告")
    lines.append(f"\n生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"\n---\n")
    
    # 项目概况
    lines.append("## 📋 项目概况\n")
    p = result['project']
    lines.append(f"| 字段 | 内容 |")
    lines.append(f"|------|------|")
    lines.append(f"| 项目名称 | {p['name']} |")
    lines.append(f"| 采购人 | {p['purchaser']} |")
    lines.append(f"| 预算金额 | ¥{p['budget']} 万 |")
    lines.append(f"| 投标截止 | {p['bid_deadline']} |")
    lines.append(f"| 评标方法 | {p['evaluation_method']} |")
    lines.append("")
    
    # 资质符合性
    lines.append("## ✅ 资质符合性\n")
    q = result['qualification']
    lines.append(f"- **综合符合率**：{q['compliance_rate']*100:.0f}%")
    lines.append(f"- 已满足：{q['matched_count']}/{q['required_count']} 项")
    if q.get('missing_items'):
        lines.append(f"- ⚠️ 缺失：{', '.join(q['missing_items'])}")
    if q.get('fatal_missing'):
        lines.append(f"- ❌ 一票否决项：{', '.join(q['fatal_missing'])}")
    lines.append("")
    
    # 竞争对手
    if result.get('competitor_analysis'):
        lines.append("## 🏢 竞争对手分析\n")
        lines.append("| 竞对名称 | 历史中标率 | 投标次数 | 优势 |")
        lines.append("|----------|-----------|----------|------|")
        for c in result['competitor_analysis'][:5]:
            lines.append(f"| {c['name']} | {c['win_rate']} | {c['bid_count']} | {', '.join(c['advantages'][:2])} |")
        lines.append("")
    
    # 报价策略
    lines.append("## 💰 报价策略\n")
    ps = result['price_strategy']
    lines.append(f"- **方法**：{ps['method']}")
    lines.append(f"- **建议报价区间**：¥{ps['suggested_range'][0]} ~ ¥{ps['suggested_range'][1]} 万")
    if ps.get('estimated_cost'):
        lines.append(f"- **预计成本**：¥{ps['estimated_cost']} 万")
    if ps.get('profit_margin'):
        lines.append(f"- **利润率**：{ps['profit_margin']*100:.1f}%")
    lines.append(f"- **依据**：{ps['rationale']}")
    lines.append("")
    
    # SWOT
    lines.append("## 📊 SWOT 分析\n")
    swot = result['swot']
    lines.append(f"| 维度 | 内容 |")
    lines.append(f"|------|------|")
    lines.append(f"| 优势(S) | {'；'.join(swot['strengths'][:3])} |")
    lines.append(f"| 劣势(W) | {'；'.join(swot['weaknesses'][:3])} |")
    lines.append(f"| 机会(O) | {'；'.join(swot['opportunities'][:3])} |")
    lines.append(f"| 威胁(T) | {'；'.join(swot['threats'][:3])} |")
    lines.append("")
    
    # 综合评估
    lines.append("## 🎯 综合评估\n")
    lines.append(f"- **综合得分**：{result['overall_score']}/100")
    lines.append(f"- **决策结论**：{result['recommendation']}")
    lines.append(f"- **置信度**：{result['confidence']}")
    lines.append(f"- **风险等级**：{result['risk_level']}")
    lines.append("")
    
    # 关键动作
    lines.append("## 📌 关键动作\n")
    for action in result['key_actions']:
        lines.append(f"- {action}")
    lines.append("")
    
    # 风险应对
    lines.append("## 🛡️ 风险应对\n")
    for m in result['risk_mitigation']:
        lines.append(f"- {m}")
    lines.append("")
    
    # 结论
    lines.append("## 💡 结论\n")
    lines.append(result['conclusion'])
    lines.append("")
    
    # 免责声明
    lines.append("---\n")
    lines.append(f"> ⚠️ {result['disclaimer']}")
    
    return '\n'.join(lines)


if __name__ == '__main__':
    main()
