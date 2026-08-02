# 反爬策略与数据采集最佳实践

## 核心原则

本 Skill 仅采集公开信息，严格遵守目标平台使用条款。以下策略旨在确保采集行为合法合规、可持续。

## 1. 请求行为规范

### 1.1 频率控制

| 指标 | 要求 | 说明 |
|------|------|------|
| 同一域名请求间隔 | ≥3 秒 | 使用 `time.sleep(3)` 或异步延迟 |
| 同一会话单域名请求上限 | ≤50 次/小时 | 超出后自动停止该域名采集 |
| 总采集时长 | ≤10 分钟/次 | 超过后自动进入冷却期 |
| 重试间隔 | 指数退避（5s → 15s → 60s） | 连续失败 3 次则放弃该域名 |

### 1.2 User-Agent 策略

**推荐标识**（透明、可识别）：

```
# 通用标识
GovProcurementBot/1.0 (compatible; Sudowork)

# 含联系方式（如果平台要求）
GovProcurementBot/1.0 (compatible; Sudowork; contact: your-email@example.com)
```

**禁止行为**：
- ❌ 使用伪造的浏览器 UA（如 `Mozilla/5.0...`）
- ❌ 使用与主流浏览器完全一致的 UA
- ❌ 不填写 UA 或使用空字符串

### 1.3 Headers 设置

采集请求应包含：

```python
headers = {
    'User-Agent': 'GovProcurementBot/1.0 (compatible; Sudowork)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Connection': 'keep-alive',
}
```

不要包含：
- ❌ 伪造的 Cookie（未登录时）
- ❌ 虚假的 Referer
- ❌ 浏览器指纹相关的 Headers

## 2. robots.txt 合规检查

### 2.1 检查流程

```
请求页面之前
    │
    ▼
获取 robots.txt（如 https://example.gov.cn/robots.txt）
    │
    ▼
解析 Disallow 规则
    │
    ├── 当前路径在 Disallow 列表中 → 停止采集，记录日志
    │
    └── 当前路径未被禁止 → 继续采集
```

### 2.2 代码示例

```python
import urllib.robotparser

def check_robots_txt(url, user_agent='GovProcurementBot'):
    """检查 robots.txt 是否允许爬取"""
    from urllib.parse import urlparse
    
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(robots_url)
    
    try:
        rp.read()
        return rp.can_fetch(user_agent, url)
    except Exception:
        # 无法获取 robots.txt 时默认不允许（保守策略）
        return False
```

## 3. 常见反爬机制及应对

### 3.1 频率限制（Rate Limiting）

**现象**：HTTP 429 Too Many Requests 或 IP 临时封禁

**应对**：
1. 降低请求频率至 ≥5 秒/次
2. 遇到 429 立即停止，等待 `Retry-After` 头指定时间（默认 60 秒）
3. 记录该域名失败状态，本次会话不再请求

```python
import time

def fetch_with_retry(url, max_retries=3):
    for attempt in range(max_retries):
        response = requests.get(url, headers=headers, timeout=10)
        
        if response.status_code == 200:
            return response
        elif response.status_code == 429:
            wait_time = int(response.headers.get('Retry-After', 60))
            time.sleep(wait_time)
        else:
            break
    
    return None  # 放弃
```

### 3.2 动态页面渲染（JS 渲染）

**现象**：页面内容通过 JavaScript 加载，请求 HTML 源码无数据

**应对**：
1. **优先分析 API 接口**：使用浏览器开发者工具（Network 标签）找到数据 API
2. **使用 Playwright**：如 API 不可用，使用 Playwright 连接获取渲染后内容
3. **不使用 Selenium/无头浏览器**（资源消耗大且违反合规要求）

### 3.3 验证码（CAPTCHA）

**现象**：页面要求输入验证码或进行人机验证

**应对**：
- ⚠️ **禁止行为**：不尝试自动破解验证码（包括 OCR 识别、机器学习模型）
- ✅ 正确做法：记录该域名，跳过并告知用户"该页面需要人机验证，无法自动采集"

### 3.4 IP 封禁

**现象**：连续请求后 IP 被临时或永久封禁

**应对**：
1. 降低频率至 ≥5 秒/次
2. 使用 Sudowork 内置 `browser` skill 访问公开页面
3. **禁止使用代理池**轮换 IP（规避检测 = 违规）

## 4. 缓存与去重

### 4.1 缓存策略

| 数据类型 | 缓存时间 | 存储方式 |
|----------|----------|----------|
| 公告列表 | 24 小时 | SQLite / 内存 |
| 公告详情 | 72 小时 | SQLite |
| robots.txt | 24 小时 | 内存 |
| 企业信息 | 7 天 | SQLite |

### 4.2 去重机制

```python
import hashlib

def generate_fingerprint(url, title):
    """生成公告指纹用于去重"""
    raw = f"{url}|{title}"
    return hashlib.md5(raw.encode()).hexdigest()
```

## 5. 错误处理流程

```
开始采集
    │
    ▼
检查 robots.txt → 禁止 → 跳过并记录
    │
    ▼
发送请求 → 403/429/503 → 等待后重试（最多3次）
    │                    └── 仍失败 → 跳过该域名
    ▼
200 成功
    │
    ▼
解析内容 → 提取字段 → 存入数据库
    │
    ▼
延迟 ≥3 秒 → 继续下一条
```

## 6. 合规红线（绝对禁止）

| 禁止行为 | 原因 |
|----------|------|
| 破解验证码 | 违反《网络安全法》第27条 |
| 绕过登录/付费墙 | 违反《计算机信息系统安全保护条例》 |
| 使用代理池轮换 IP | 构成规避安全保护措施 |
| 伪造设备指纹 | 构成身份欺诈 |
| 采集非公开信息 | 违反《个人信息保护法》 |
| 转售原始数据 | 违反平台使用条款 |
| DDOS 式采集 | 违反《网络安全法》 |

## 7. 推荐工具选择

| 工具 | 适用场景 | 合规性 |
|------|----------|--------|
| **browser skill**（内置） | 公开网页与动态页面 | ⭐⭐⭐⭐⭐ 最推荐 |
| **requests + BeautifulSoup** | 静态页面解析 | ⭐⭐⭐⭐ 推荐 |
| **Playwright** | JS 动态渲染页面 | ⭐⭐⭐ 可用（需用户授权） |
| **Scrapy** | 大型采集任务 | ⭐⭐ 过于重量级，不推荐 |
| **Selenium/无头浏览器** | - | ❌ 不推荐（合规风险高） |

---

*遵守反爬规则不仅保护目标站点正常运行，也确保 Skill 自身的可持续性。*
*如目标平台明确禁止爬取，请立即停止使用并告知用户。*