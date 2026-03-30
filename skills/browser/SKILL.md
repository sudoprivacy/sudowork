---
name: browser
description: "AI-native browser. Explore websites, discover page structure, take screenshots, and automate interactions."
---

# Browser

Each tool is a Python module: `python3 -m ai_dev_browser.tools.<name> --help`.

List all available tools:

```bash
python3 -c "import ai_dev_browser.tools as t, pkgutil; print('\n'.join(m.name for m in pkgutil.iter_modules(t.__path__) if not m.name.startswith('_')))"
```

## Headless by default

Always start browsers with `--headless` unless the user asks to see the window or you need to debug a visual issue.
