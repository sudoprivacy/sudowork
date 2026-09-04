/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export function renderShareTemplate(opts: { title: string; contentHtml: string; timestamp: string }): string {
  return TEMPLATE.replaceAll('{{TITLE}}', escapeHtml(opts.title)).replaceAll('{{CONTENT_HTML}}', opts.contentHtml).replaceAll('{{TIMESTAMP}}', escapeHtml(opts.timestamp));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const TEMPLATE = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{TITLE}}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff; --fg: #1a1a1a; --heading: #111111; --muted: #6b7280;
        --border: #e5e7eb; --code-bg: #f3f4f6; --code-fg: #1f2937;
        --blockquote-border: #d1d5db; --blockquote-bg: #f9fafb;
        --link: #2563eb; --link-hover: #1d4ed8;
        --table-header-bg: #f9fafb; --table-stripe: #f9fafb;
      }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f0f0f; --fg: #e5e5e5; --heading: #f5f5f5; --muted: #9ca3af;
        --border: #374151; --code-bg: #1f2937; --code-fg: #d1d5db;
        --blockquote-border: #4b5563; --blockquote-bg: #1f2937;
        --link: #60a5fa; --link-hover: #93bbfd;
        --table-header-bg: #1f2937; --table-stripe: #111827;
      }
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 15px; line-height: 1.7; color: var(--fg);
      background: var(--bg); padding: 0; margin: 0;
    }

    .container {
      max-width: 760px; margin: 0 auto; padding: 40px 20px;
    }

    header { margin-bottom: 32px; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
    header h1 { font-size: 28px; font-weight: 700; color: var(--heading); margin-bottom: 4px; line-height: 1.3; }
    header .meta { font-size: 13px; color: var(--muted); }

    h1, h2, h3, h4, h5, h6 { color: var(--heading); margin: 24px 0 8px; font-weight: 600; line-height: 1.3; }
    h1 { font-size: 24px; } h2 { font-size: 20px; } h3 { font-size: 18px; }

    p { margin: 0 0 14px; }

    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; color: var(--link-hover); }

    ul, ol { margin: 0 0 14px 24px; }
    li { margin-bottom: 4px; }

    code {
      font-family: "SF Mono", "Fira Code", "Cascadia Code", Menlo, Consolas, monospace;
      font-size: 13px; background: var(--code-bg); color: var(--code-fg);
      padding: 2px 6px; border-radius: 4px;
    }
    pre {
      background: var(--code-bg); color: var(--code-fg); padding: 16px;
      border-radius: 8px; overflow-x: auto; margin: 0 0 14px;
      font-size: 13px; line-height: 1.5;
    }
    pre code { background: none; padding: 0; border-radius: 0; }

    blockquote {
      border-left: 4px solid var(--blockquote-border); background: var(--blockquote-bg);
      padding: 12px 16px; margin: 0 0 14px; border-radius: 0 4px 4px 0;
    }
    blockquote p:last-child { margin-bottom: 0; }

    table { width: 100%; border-collapse: collapse; margin: 0 0 14px; }
    th, td { border: 1px solid var(--border); padding: 10px 14px; text-align: left; }
    th { background: var(--table-header-bg); font-weight: 600; }
    tr:nth-child(even) td { background: var(--table-stripe); }

    footer {
      margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--border);
      font-size: 12px; color: var(--muted); text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="meta">Shared from SudoWork · {{TIMESTAMP}}</div>
      <h1>{{TITLE}}</h1>
    </header>
    <main>{{CONTENT_HTML}}</main>
    <footer>Powered by ShareOne</footer>
  </div>
</body>
</html>`;
