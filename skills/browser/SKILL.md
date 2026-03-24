---
name: browser
description: "AI-native browser. Explore websites, discover page structure, take screenshots, and automate interactions."
---

# Browser

Start by discovering available tools:

```bash
ls $(python -c "import ai_dev_browser.tools, os; print(os.path.dirname(ai_dev_browser.tools.__file__))")
```

Each tool maps 1:1 to a Python function, so a sequence of tool calls translates directly into a Python script.
