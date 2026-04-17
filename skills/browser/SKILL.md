---
name: browser
description: "AI-native browser. Explore websites, discover page structure, take screenshots, and automate interactions."
---

# Browser

```bash
ls skills/browser/ai_dev_browser/tools/
python -m ai_dev_browser.tools.<name> [--flag ...]
```

Every CLI tool has an identical Python function in `ai_dev_browser.core` — explore interactively with CLI, then script with the same functions:

```python
from ai_dev_browser.core import page_goto, click_by_text, page_screenshot
```
