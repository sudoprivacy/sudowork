"""
政府采购数据采集脚本（合规版）
适用范围：静态/半静态HTML公告页面的结构化提取

使用方式：
  python collected_data.py --url <公告列表页URL> --output <输出JSON路径>
  
重要：
  - 本脚本仅采集公开信息
  - 请求前自动检查 robots.txt
  - 默认请求间隔 3 秒
  - 禁止绕过任何安全机制
"""

import argparse
import hashlib
import json
import os
import re
import time
import urllib.robotparser
from datetime import datetime
from typing import Optional

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    requests = None
    BeautifulSoup = None


# === 配置 ===
USER_AGENT = "GovProcurementBot/1.0 (compatible; Sudowork)"
REQUEST_TIMEOUT = 15  # 秒
REQUEST_DELAY = 3  # 同一域名请求间隔（秒）
MAX_RETRIES = 2
MAX_PAGES_PER_SESSION = 20  # 单次会话最大翻页数


class ComplianceChecker:
    """robots.txt 合规检查"""
    
    def __init__(self):
        self._cache = {}
    
    def is_allowed(self, url: str) -> bool:
        """检查是否允许爬取"""
        from urllib.parse import urlparse
        
        parsed = urlparse(url)
        domain = f"{parsed.scheme}://{parsed.netloc}"
        
        if domain not in self._cache:
            rp = urllib.robotparser.RobotFileParser()
            rp.set_url(f"{domain}/robots.txt")
            try:
                rp.read()
                self._cache[domain] = rp
            except Exception:
                # 无法获取 robots.txt → 保守策略：不允许
                return False
        
        rp = self._cache[domain]
        return rp.can_fetch(USER_AGENT, url)
    
    def get_crawl_delay(self, url: str) -> int:
        """获取 Crawl-delay 指令"""
        from urllib.parse import urlparse
        
        parsed = urlparse(url)
        domain = f"{parsed.scheme}://{parsed.netloc}"
        
        if domain in self._cache:
            delay = self._cache[domain].crawl_delay(USER_AGENT)
            if delay and delay > REQUEST_DELAY:
                return delay
        
        return REQUEST_DELAY


class EthicalFetcher:
    """合规采集器"""
    
    def __init__(self):
        self.compliance = ComplianceChecker()
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
        })
        self.last_request_time = {}  # domain -> timestamp
        self.failed_domains = set()  # 记录失败的域名
    
    def fetch(self, url: str, retry_count: int = 0) -> Optional[str]:
        """
        合规获取页面内容
        返回 HTML 文本，失败返回 None
        """
        from urllib.parse import urlparse
        
        # 1. 检查 robots.txt
        if not self.compliance.is_allowed(url):
            print(f"[BLOCKED] robots.txt 禁止: {url}")
            return None
        
        # 2. 检查域名是否已标记为失败
        domain = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        if domain in self.failed_domains:
            print(f"[SKIP] 域名 {domain} 已标记为失败，跳过")
            return None
        
        # 3. 频率控制
        delay = self.compliance.get_crawl_delay(url)
        last_time = self.last_request_time.get(domain, 0)
        elapsed = time.time() - last_time
        if elapsed < delay:
            time.sleep(delay - elapsed)
        
        # 4. 发送请求
        try:
            response = self.session.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            self.last_request_time[domain] = time.time()
            
            if response.status_code == 200:
                response.encoding = response.apparent_encoding or 'utf-8'
                return response.text
            
            elif response.status_code == 429:
                # Too Many Requests
                wait_time = int(response.headers.get('Retry-After', 60))
                if retry_count < MAX_RETRIES:
                    print(f"[RATE LIMIT] 等待 {wait_time} 秒后重试...")
                    time.sleep(wait_time)
                    return self.fetch(url, retry_count + 1)
                else:
                    self.failed_domains.add(domain)
                    print(f"[BLOCKED] 域名 {domain} 请求频率受限")
                    return None
            
            elif response.status_code in (403, 503):
                self.failed_domains.add(domain)
                print(f"[BLOCKED] 域名 {domain} 拒绝访问 ({response.status_code})")
                return None
            
            else:
                print(f"[HTTP {response.status_code}] {url}")
                return None
        
        except requests.exceptions.Timeout:
            print(f"[TIMEOUT] {url}")
            if retry_count < MAX_RETRIES:
                return self.fetch(url, retry_count + 1)
            return None
        
        except requests.exceptions.RequestException as e:
            print(f"[ERROR] 请求失败: {e}")
            return None


class ProcurementParser:
    """公告解析器（通用CSS选择器 + 正则回退）"""
    
    # 常见金额正则
    AMOUNT_PATTERNS = [
        r'预算[金额]*[：:]\s*([0-9.,]+)\s*[万]?元',
        r'预算[：:]\s*¥\s*([0-9.,]+)',
        r'最高限价[：:]\s*([0-9.,]+)\s*[万]?元',
        r'项目预算[：:]\s*([0-9.,]+)',
        r'采购预算[：:]\s*([0-9.,]+)',
    ]
    
    # 日期正则
    DATE_PATTERNS = [
        r'(\d{4}[-/年]\d{1,2}[-/月]\d{1,2})',
        r'截止[日期时间]*[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2})',
        r'开标[日期时间]*[：:]\s*(\d{4}[-/年]\d{1,2}[-/月]\d{1,2})',
    ]
    
    @staticmethod
    def extract_amount(text: str) -> Optional[float]:
        """提取预算金额（万元）"""
        for pattern in ProcurementParser.AMOUNT_PATTERNS:
            match = re.search(pattern, text)
            if match:
                amount_str = match.group(1).replace(',', '')
                try:
                    amount = float(amount_str)
                    # 如果单位是元，转换为万
                    if '元' in text and '万元' not in text and amount > 100000:
                        amount = amount / 10000
                    return round(amount, 2)
                except ValueError:
                    continue
        return None
    
    @staticmethod
    def extract_date(text: str) -> Optional[str]:
        """提取招标日期"""
        for pattern in ProcurementParser.DATE_PATTERNS:
            match = re.search(pattern, text)
            if match:
                return match.group(1).replace('年', '-').replace('月', '-').replace('/', '-')
        return None
    
    @staticmethod
    def generate_id(url: str, title: str) -> str:
        """生成公告ID"""
        raw = f"{url}|{title}"
        return hashlib.md5(raw.encode()).hexdigest()[:16]
    
    def parse_list_page(self, html: str, platform_config: dict) -> list:
        """
        解析公告列表页
        platform_config 包含 CSS 选择器配置
        """
        soup = BeautifulSoup(html, 'html.parser')
        items = []
        
        rows = soup.select(platform_config.get('list_selector', 'tr'))
        
        for row in rows:
            try:
                # 标题和链接
                title_elem = row.select_one(platform_config.get('title_selector', 'a'))
                if not title_elem:
                    continue
                
                title = title_elem.get_text(strip=True)
                link = title_elem.get('href', '')
                
                # 补全URL
                if link and not link.startswith('http'):
                    from urllib.parse import urlparse
                    base = platform_config.get('base_url', '')
                    if base:
                        link = base.rstrip('/') + '/' + link.lstrip('/')
                
                # 日期
                date_elem = row.select_one(platform_config.get('date_selector', '.date, .time'))
                date_str = date_elem.get_text(strip=True) if date_elem else None
                
                # 地区
                region_elem = row.select_one(platform_config.get('region_selector', '.area'))
                region = region_elem.get_text(strip=True) if region_elem else None
                
                items.append({
                    'id': self.generate_id(link, title),
                    'title': title,
                    'link': link,
                    'publish_date': date_str,
                    'region': region,
                    'parsed_at': datetime.now().isoformat(),
                })
            
            except Exception as e:
                print(f"[PARSE ERROR] {e}")
                continue
        
        return items
    
    def parse_detail_page(self, html: str, url: str) -> dict:
        """提取公告详情"""
        soup = BeautifulSoup(html, 'html.parser')
        
        # 移除脚本和样式
        for tag in soup(['script', 'style', 'nav', 'footer']):
            tag.decompose()
        
        text = soup.get_text(separator='\n', strip=True)
        
        # 提取各字段
        amount = self.extract_amount(text)
        bid_date = self.extract_date(text)
        
        # 项目名称（通常是第一个 h1/h2/h3）
        project_name = ''
        for tag in ['h1', 'h2', 'h3']:
            elem = soup.find(tag)
            if elem:
                project_name = elem.get_text(strip=True)
                break
        
        return {
            'url': url,
            'project_name': project_name,
            'amount': amount,
            'bid_deadline': bid_date,
            'raw_text': text[:5000],  # 截断，避免过大
            'parsed_at': datetime.now().isoformat(),
        }


# === 平台配置示例 ===
PLATFORM_CONFIGS = {
    'ccgp': {
        'name': '中国政府采购网',
        'base_url': 'http://www.ccgp.gov.cn',
        'list_url': 'http://search.ccgp.gov.cn/bxsearch?searchtype=1&page_index={page}&bidSort=0&pinMu=0&bidType=0&dbselect=bidx&kw=&timeType=0',
        'list_selector': '.vT-srch-result-list-bid li',
        'title_selector': 'a',
        'date_selector': '.sp',
        'region_selector': None,
    },
    'custom': {
        'name': '自定义平台',
        'base_url': '',
        'list_url': '',
        'list_selector': 'tr',
        'title_selector': 'a',
        'date_selector': '.date',
        'region_selector': '.area',
    },
}


def main():
    parser = argparse.ArgumentParser(description='政府采购公告采集（合规版）')
    parser.add_argument('--url', required=True, help='公告列表页URL')
    parser.add_argument('--output', default='collected_announcements.json', help='输出JSON文件路径')
    parser.add_argument('--pages', type=int, default=1, help='采集页数（最多20页）')
    parser.add_argument('--platform', default='ccgp', help='平台key（ccgp 或 custom）')
    parser.add_argument('--base-url', help='基础URL，用于补全相对链接')
    
    args = parser.parse_args()

    if requests is None or BeautifulSoup is None:
        parser.error('缺少可选依赖 requests/beautifulsoup4；请改用内置 browser skill，或由管理员预装依赖')

    args.pages = min(args.pages, MAX_PAGES_PER_SESSION)
    
    # 初始化
    fetcher = EthicalFetcher()
    parser_obj = ProcurementParser()
    
    config = PLATFORM_CONFIGS.get(args.platform, PLATFORM_CONFIGS['custom']).copy()
    if args.base_url:
        config['base_url'] = args.base_url
    
    all_items = []
    
    # 采集列表页
    for page in range(1, args.pages + 1):
        page_url = args.url.format(page=page) if '{page}' in args.url else f"{args.url}&page={page}"
        
        print(f"[采集] 第{page}页: {page_url[:80]}...")
        html = fetcher.fetch(page_url)
        
        if not html:
            print(f"[停止] 第{page}页采集失败，停止翻页")
            break
        
        items = parser_obj.parse_list_page(html, config)
        print(f"  → 解析到 {len(items)} 条公告")
        all_items.extend(items)
        
        # 最低频率限制
        time.sleep(REQUEST_DELAY)
    
    # 保存结果
    output = {
        'platform': config.get('name', args.platform),
        'source_url': args.url,
        'generated_at': datetime.now().isoformat(),
        'total_count': len(all_items),
        'compliance_note': '本采集严格遵守 robots.txt，仅获取公开信息。请求间隔 ≥3 秒。',
        'data': all_items,
    }
    
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    
    print(f"\n[完成] 采集了 {len(all_items)} 条公告")
    print(f"[输出] {os.path.abspath(args.output)}")
    
    return output


if __name__ == '__main__':
    main()
