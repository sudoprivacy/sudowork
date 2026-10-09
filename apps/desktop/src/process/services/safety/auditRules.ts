/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill Audit Detection Rules
 *
 * Pattern-based rules for detecting operations performed by custom skills.
 * Each rule maps a regex pattern to an audit category (network, filesystem, etc.)
 */

import type { AuditCategory, AuditLanguage } from '@/common/skillAuditTypes';

/** A single audit detection rule */
export interface AuditRule {
  /** Unique rule identifier */
  id: string;
  /** Target language */
  language: AuditLanguage;
  /** Audit category */
  category: AuditCategory;
  /** Regex pattern to match */
  pattern: RegExp;
  /** Human-readable description */
  description: string;
}

// ==================== Python Rules ====================

export const PYTHON_RULES: AuditRule[] = [
  // External API calls
  {
    id: 'py-api-requests',
    language: 'python',
    category: 'external_api',
    pattern: /\brequests\.(get|post|put|delete|patch|head|options|request)\s*\(/,
    description: 'requests HTTP 库调用',
  },
  {
    id: 'py-api-httpx',
    language: 'python',
    category: 'external_api',
    pattern: /\bhttpx\.(get|post|put|delete|patch|head|options|request|AsyncClient|Client)\s*\(/,
    description: 'httpx HTTP 库调用',
  },
  {
    id: 'py-api-aiohttp',
    language: 'python',
    category: 'external_api',
    pattern: /\baiohttp\.(ClientSession|request)\b/,
    description: 'aiohttp HTTP 库调用',
  },
  {
    id: 'py-api-urllib',
    language: 'python',
    category: 'external_api',
    pattern: /\burllib\.(request\.urlopen|request\.Request|parse\.urlencode)\b/,
    description: 'urllib 库调用',
  },

  // Network connections
  {
    id: 'py-net-socket',
    language: 'python',
    category: 'network',
    pattern: /\bsocket\.(socket|create_connection|connect)\b/,
    description: 'socket 网络连接',
  },
  {
    id: 'py-net-import-socket',
    language: 'python',
    category: 'network',
    pattern: /^\s*import\s+socket\b/,
    description: '导入 socket 模块',
  },
  {
    id: 'py-net-import-requests',
    language: 'python',
    category: 'network',
    pattern: /^\s*import\s+(requests|httpx|aiohttp)\b/,
    description: '导入网络请求库',
  },
  {
    id: 'py-net-from-import',
    language: 'python',
    category: 'network',
    pattern: /^\s*from\s+(requests|httpx|aiohttp|urllib)\s+import\b/,
    description: '导入网络请求库组件',
  },

  // Sensitive data collection
  {
    id: 'py-sens-environ',
    language: 'python',
    category: 'sensitive_data',
    pattern: /\bos\.environ\b/,
    description: '访问环境变量',
  },
  {
    id: 'py-sens-getenv',
    language: 'python',
    category: 'sensitive_data',
    pattern: /\bos\.getenv\s*\(/,
    description: '读取环境变量',
  },
  {
    id: 'py-sens-getpass',
    language: 'python',
    category: 'sensitive_data',
    pattern: /\bgetpass\.(getpass|getuser)\s*\(/,
    description: '获取密码/用户信息',
  },
  {
    id: 'py-sens-keyring',
    language: 'python',
    category: 'sensitive_data',
    pattern: /\bkeyring\.(get_password|set_password|get_credential)\s*\(/,
    description: '访问系统密钥链',
  },

  // File system access
  {
    id: 'py-fs-open',
    language: 'python',
    category: 'filesystem',
    pattern: /\bopen\s*\([^)]*(['"][waxr+b]+['"]|mode\s*=)/,
    description: '文件打开操作',
  },
  {
    id: 'py-fs-pathlib',
    language: 'python',
    category: 'filesystem',
    pattern: /\bpathlib\.Path\b/,
    description: 'pathlib 路径操作',
  },
  {
    id: 'py-fs-shutil',
    language: 'python',
    category: 'filesystem',
    pattern: /\bshutil\.(copy|copy2|copytree|move|rmtree|disk_usage)\s*\(/,
    description: 'shutil 文件操作',
  },
  {
    id: 'py-fs-os-path',
    language: 'python',
    category: 'filesystem',
    pattern: /\bos\.(remove|unlink|rmdir|makedirs|mkdir|rename|listdir|walk|scandir)\s*\(/,
    description: 'os 文件系统操作',
  },
  {
    id: 'py-fs-glob',
    language: 'python',
    category: 'filesystem',
    pattern: /\bglob\.(glob|iglob)\s*\(/,
    description: 'glob 文件搜索',
  },

  // Executable/command execution
  {
    id: 'py-exec-subprocess',
    language: 'python',
    category: 'executable',
    pattern: /\bsubprocess\.(run|call|check_output|check_call|Popen)\s*\(/,
    description: 'subprocess 命令执行',
  },
  {
    id: 'py-exec-os-system',
    language: 'python',
    category: 'executable',
    pattern: /\bos\.(system|popen|exec[lv]p?e?)\s*\(/,
    description: 'os.system 命令执行',
  },
  {
    id: 'py-exec-eval',
    language: 'python',
    category: 'executable',
    pattern: /\b(eval|exec)\s*\(/,
    description: '动态代码执行 (eval/exec)',
  },
  {
    id: 'py-exec-compile',
    language: 'python',
    category: 'executable',
    pattern: /\bcompile\s*\([^)]*['"]exec['"]/,
    description: '动态代码编译执行',
  },
];

// ==================== Shell Rules ====================

export const SHELL_RULES: AuditRule[] = [
  // External API calls
  {
    id: 'sh-api-curl',
    language: 'shell',
    category: 'external_api',
    pattern: /\bcurl\s+(-[a-zA-Z]|--[a-zA-Z]|['"`]?https?:\/\/|\$[{(a-zA-Z_])/,
    description: 'curl HTTP 请求',
  },
  {
    id: 'sh-api-wget',
    language: 'shell',
    category: 'external_api',
    pattern: /\bwget\s+(-[a-zA-Z]|--[a-zA-Z]|['"`]?https?:\/\/|\$[{(a-zA-Z_])/,
    description: 'wget 下载请求',
  },
  {
    id: 'sh-api-httpie',
    language: 'shell',
    category: 'external_api',
    pattern: /\b(http|https)\s+(GET|POST|PUT|DELETE|PATCH|HEAD)\s+/,
    description: 'HTTPie 请求',
  },

  // Network connections
  {
    id: 'sh-net-nc',
    language: 'shell',
    category: 'network',
    pattern: /\b(nc|netcat|ncat)\s+/,
    description: 'netcat 网络连接',
  },
  {
    id: 'sh-net-ssh',
    language: 'shell',
    category: 'network',
    pattern: /\bssh\s+/,
    description: 'SSH 远程连接',
  },
  {
    id: 'sh-net-scp',
    language: 'shell',
    category: 'network',
    pattern: /\b(scp|rsync)\s+/,
    description: '远程文件传输',
  },
  {
    id: 'sh-net-ping',
    language: 'shell',
    category: 'network',
    pattern: /\bping\s+/,
    description: 'ping 网络探测',
  },

  // Sensitive data
  {
    id: 'sh-sens-password',
    language: 'shell',
    category: 'sensitive_data',
    pattern: /\$\{?(PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY|SECRET_KEY)\}?/i,
    description: '引用敏感环境变量',
  },
  {
    id: 'sh-sens-env-read',
    language: 'shell',
    category: 'sensitive_data',
    pattern: /\bprintenv\b|\benv\s/,
    description: '读取环境变量',
  },

  // File system — dangerous operations
  {
    id: 'sh-fs-rm',
    language: 'shell',
    category: 'filesystem',
    pattern: /\brm\s+(-[rfidv]+\s+|)(?!.*\.(log|tmp|cache)\b)/,
    description: '文件删除操作',
  },
  {
    id: 'sh-fs-chmod',
    language: 'shell',
    category: 'filesystem',
    pattern: /\bchmod\s+/,
    description: '文件权限修改',
  },
  {
    id: 'sh-fs-chown',
    language: 'shell',
    category: 'filesystem',
    pattern: /\bchown\s+/,
    description: '文件所有者修改',
  },
  {
    id: 'sh-fs-dd',
    language: 'shell',
    category: 'filesystem',
    pattern: /\bdd\s+/,
    description: 'dd 磁盘操作',
  },
  {
    id: 'sh-fs-mktemp',
    language: 'shell',
    category: 'filesystem',
    pattern: /\bmktemp\b/,
    description: '创建临时文件',
  },

  // Executable — dynamic command execution
  {
    id: 'sh-exec-eval',
    language: 'shell',
    category: 'executable',
    pattern: /\beval\s+/,
    description: 'eval 动态命令执行',
  },
  {
    id: 'sh-exec-bash-c',
    language: 'shell',
    category: 'executable',
    pattern: /\b(bash|sh|zsh)\s+-c\s+/,
    description: 'shell -c 命令执行',
  },
  {
    id: 'sh-exec-source',
    language: 'shell',
    category: 'executable',
    pattern: /\bsource\s+[^\s]+/,
    description: 'source 脚本执行',
  },
  {
    id: 'sh-exec-dot-source',
    language: 'shell',
    category: 'executable',
    pattern: /(?:^|[;&|]\s*)\.\s+(\/[^\s;|&]+|\.\.?\/[^\s;|&]+|~\/[^\s;|&]+|\$[^\s;|&]+)/,
    description: '. (dot) 脚本执行',
  },
  {
    id: 'sh-exec-install',
    language: 'shell',
    category: 'executable',
    pattern: /\b(pip|pip3|npm|yarn|pnpm|brew|apt-get|yum|dnf)\s+(install|add)\s+/,
    description: '包管理器安装',
  },
];

// ==================== JavaScript/TypeScript Rules ====================

export const JS_TS_RULES: AuditRule[] = [
  // External API calls
  {
    id: 'js-api-fetch',
    language: 'javascript',
    category: 'external_api',
    pattern: /\bfetch\s*\(/,
    description: 'fetch API 调用',
  },
  {
    id: 'js-api-axios',
    language: 'javascript',
    category: 'external_api',
    pattern: /\baxios\.(get|post|put|delete|patch|head|request|create)\s*\(/,
    description: 'axios HTTP 请求',
  },
  {
    id: 'js-api-xhr',
    language: 'javascript',
    category: 'external_api',
    pattern: /\bnew\s+XMLHttpRequest\s*\(/,
    description: 'XMLHttpRequest 请求',
  },
  {
    id: 'js-api-http-request',
    language: 'javascript',
    category: 'external_api',
    pattern: /\b(https?)\.(request|get)\s*\(/,
    description: 'Node.js http/https 请求',
  },
  {
    id: 'js-api-got',
    language: 'javascript',
    category: 'external_api',
    pattern: /\bgot\.(get|post|put|delete|patch|head)\s*\(/,
    description: 'got HTTP 请求',
  },
  {
    id: 'js-api-node-fetch',
    language: 'javascript',
    category: 'external_api',
    pattern: /\brequire\s*\(\s*['"]node-fetch['"]\s*\)/,
    description: 'node-fetch 导入',
  },

  // Network connections
  {
    id: 'js-net-import',
    language: 'javascript',
    category: 'network',
    pattern: /\brequire\s*\(\s*['"](axios|got|node-fetch|request|superagent|undici)['"]\s*\)/,
    description: '导入网络请求库',
  },
  {
    id: 'js-net-import-es',
    language: 'javascript',
    category: 'network',
    pattern: /\bimport\s+.*\s+from\s+['"](axios|got|node-fetch|request|superagent|undici)['"]/,
    description: '导入网络请求库 (ES)',
  },
  {
    id: 'js-net-websocket',
    language: 'javascript',
    category: 'network',
    pattern: /\bnew\s+WebSocket\s*\(/,
    description: 'WebSocket 连接',
  },
  {
    id: 'js-net-socket',
    language: 'javascript',
    category: 'network',
    pattern: /\brequire\s*\(\s*['"]net['"]\s*\)/,
    description: 'Node.js net 模块',
  },

  // Sensitive data
  {
    id: 'js-sens-env',
    language: 'javascript',
    category: 'sensitive_data',
    pattern: /\bprocess\.env\b/,
    description: '访问环境变量',
  },
  {
    id: 'js-sens-dotenv',
    language: 'javascript',
    category: 'sensitive_data',
    pattern: /\brequire\s*\(\s*['"]dotenv['"]\s*\)/,
    description: '导入 dotenv 环境变量',
  },
  {
    id: 'js-sens-localstorage',
    language: 'javascript',
    category: 'sensitive_data',
    pattern: /\blocalStorage\.(getItem|setItem)\s*\(/,
    description: 'localStorage 数据存储',
  },
  {
    id: 'js-sens-cookie',
    language: 'javascript',
    category: 'sensitive_data',
    pattern: /\bdocument\.cookie\b/,
    description: '访问 Cookie',
  },

  // File system
  {
    id: 'js-fs-read',
    language: 'javascript',
    category: 'filesystem',
    pattern: /\bfs\w*\.(readFile|readFileSync|readdir|readdirSync|createReadStream)\s*\(/,
    description: '文件读取操作',
  },
  {
    id: 'js-fs-write',
    language: 'javascript',
    category: 'filesystem',
    pattern: /\bfs\w*\.(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/,
    description: '文件写入操作',
  },
  {
    id: 'js-fs-delete',
    language: 'javascript',
    category: 'filesystem',
    pattern: /\bfs\w*\.(unlink|unlinkSync|rmSync|rm|rmdir|rmdirSync)\s*\(/,
    description: '文件删除操作',
  },
  {
    id: 'js-fs-import',
    language: 'javascript',
    category: 'filesystem',
    pattern: /\brequire\s*\(\s*['"]fs['"]\s*\)|import\s+.*\s+from\s+['"]fs['"]/,
    description: '导入 fs 模块',
  },
  {
    id: 'js-fs-path',
    language: 'javascript',
    category: 'filesystem',
    pattern: /\bpath\.(join|resolve|dirname|basename|normalize)\s*\(/,
    description: 'path 路径操作',
  },

  // Executable — command execution
  {
    id: 'js-exec-child-process',
    language: 'javascript',
    category: 'executable',
    pattern: /\b(child_process|cp)\.(exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/,
    description: 'child_process 命令执行',
  },
  {
    id: 'js-exec-import-cp',
    language: 'javascript',
    category: 'executable',
    pattern: /\brequire\s*\(\s*['"]child_process['"]\s*\)|import\s+.*\s+from\s+['"]child_process['"]/,
    description: '导入 child_process 模块',
  },
  {
    id: 'js-exec-eval',
    language: 'javascript',
    category: 'executable',
    pattern: /\beval\s*\(/,
    description: 'eval 动态代码执行',
  },
  {
    id: 'js-exec-new-function',
    language: 'javascript',
    category: 'executable',
    pattern: /\bnew\s+Function\s*\(/,
    description: 'new Function 动态代码执行',
  },
  {
    id: 'js-exec-shell',
    language: 'javascript',
    category: 'executable',
    pattern: /\brequire\s*\(\s*['"]shelljs['"]\s*\)/,
    description: 'ShellJS 命令执行',
  },
];

/** Get all rules for a given language */
export function getRulesForLanguage(language: AuditLanguage): AuditRule[] {
  switch (language) {
    case 'python':
      return PYTHON_RULES;
    case 'shell':
      return SHELL_RULES;
    case 'javascript':
    case 'typescript':
      return JS_TS_RULES;
    default:
      return [];
  }
}

/** Get all rules across all languages */
export function getAllRules(): AuditRule[] {
  return [...PYTHON_RULES, ...SHELL_RULES, ...JS_TS_RULES];
}
