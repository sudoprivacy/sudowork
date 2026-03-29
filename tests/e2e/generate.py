#!/usr/bin/env python3
"""
Generate primitives/ and ops/ from human-browser-primitives spec + ops-spec.yaml.

Usage:
    python tests/e2e/generate.py

Reads:
    - ../human-browser-primitives/spec.md  (W3C core primitives)
    - tests/e2e/ops-spec.yaml              (app-specific convenience params)

Writes:
    - tests/e2e/primitives/*.py            (core implementations, DO NOT EDIT)
    - tests/e2e/ops/*.py                   (thin wrappers with convenience params, DO NOT EDIT)
"""

import os
import re
import textwrap
from pathlib import Path

import yaml

E2E_DIR = Path(__file__).parent
PROJECT_ROOT = E2E_DIR.parent.parent
SPEC_PATH = PROJECT_ROOT.parent / "human-browser-primitives" / "spec.md"
OPS_SPEC_PATH = E2E_DIR / "ops-spec.yaml"
PRIMITIVES_DIR = E2E_DIR / "primitives"
OPS_DIR = E2E_DIR / "ops"

HEADER = '''\
# AUTO-GENERATED — DO NOT EDIT
# Re-run: python tests/e2e/generate.py
#
# Spec: https://github.com/sudoprivacy/human-browser-primitives
# Source: {source}
'''

# CDP implementation for each primitive
CDP_IMPLEMENTATIONS = {
    "key_down": {
        "imports": "from ai_dev_browser.cdp import input_ as cdp_input",
        "body": textwrap.dedent("""\
            await tab.send(cdp_input.dispatch_key_event(
                "rawKeyDown", key=value, code=f"Key{value.upper()}" if len(value) == 1 else value,
                windows_virtual_key_code=ord(value.upper()) if len(value) == 1 else _KEY_CODES.get(value, 0),
                modifiers=0,
            ))
            return {"pressed": True, "value": value}"""),
    },
    "key_up": {
        "imports": "from ai_dev_browser.cdp import input_ as cdp_input",
        "body": textwrap.dedent("""\
            await tab.send(cdp_input.dispatch_key_event(
                "keyUp", key=value, code=f"Key{value.upper()}" if len(value) == 1 else value,
                windows_virtual_key_code=ord(value.upper()) if len(value) == 1 else _KEY_CODES.get(value, 0),
                modifiers=0,
            ))
            return {"released": True, "value": value}"""),
    },
    "pointer_down": {
        "imports": "from ai_dev_browser.cdp import input_ as cdp_input",
        "body": textwrap.dedent("""\
            await tab.send(cdp_input.dispatch_mouse_event(
                "mousePressed", x=_last_pointer[0], y=_last_pointer[1],
                button=cdp_input.MouseButton("left") if button == 0 else cdp_input.MouseButton("right") if button == 2 else cdp_input.MouseButton("middle"),
                click_count=1,
            ))
            return {"pressed": True, "button": button}"""),
    },
    "pointer_up": {
        "imports": "from ai_dev_browser.cdp import input_ as cdp_input",
        "body": textwrap.dedent("""\
            await tab.send(cdp_input.dispatch_mouse_event(
                "mouseReleased", x=_last_pointer[0], y=_last_pointer[1],
                button=cdp_input.MouseButton("left") if button == 0 else cdp_input.MouseButton("right") if button == 2 else cdp_input.MouseButton("middle"),
                click_count=1,
            ))
            return {"released": True, "button": button}"""),
    },
    "pointer_move": {
        "imports": "from ai_dev_browser.cdp import input_ as cdp_input",
        "body": textwrap.dedent("""\
            await tab.send(cdp_input.dispatch_mouse_event(
                "mouseMoved", x=x, y=y,
            ))
            _last_pointer[0] = x
            _last_pointer[1] = y
            return {"moved": True, "x": x, "y": y}"""),
    },
    "scroll": {
        "imports": "from ai_dev_browser.cdp import input_ as cdp_input",
        "body": textwrap.dedent("""\
            await tab.send(cdp_input.dispatch_mouse_event(
                "mouseWheel", x=x, y=y, delta_x=delta_x, delta_y=delta_y,
            ))
            return {"scrolled": True, "x": x, "y": y, "delta_x": delta_x, "delta_y": delta_y}"""),
    },
    "pause": {
        "imports": "import asyncio",
        "body": textwrap.dedent("""\
            await asyncio.sleep(duration / 1000.0)
            return {"paused": True, "duration": duration}"""),
    },
    "screenshot": {
        "imports": "from ai_dev_browser.core.page import js_exec\nimport base64",
        "body": textwrap.dedent("""\
            r = await tab.send({"method": "Page.captureScreenshot", "params": {"format": "png"}})
            data = r.get("result", {}).get("data", "")
            return {"screenshot": True, "data_length": len(data), "base64": data}"""),
    },
    "get_text": {
        "imports": "from ai_dev_browser.core.page import js_exec",
        "body": textwrap.dedent("""\
            r = await js_exec(tab, \"\"\"(() => {
                function walk(root) {
                    let text = '';
                    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                    while (walker.nextNode()) { text += walker.currentNode.textContent; }
                    root.querySelectorAll('*').forEach(el => {
                        if (el.shadowRoot) { text += walk(el.shadowRoot); }
                    });
                    return text;
                }
                return walk(document.body);
            })()\"\"\")
            return {"text": r.get("result", "")}"""),
    },
    "get_attribute": {
        "imports": "from ai_dev_browser.core.page import js_exec",
        "body": textwrap.dedent("""\
            r = await js_exec(tab, f\"\"\"(() => {{
                const el = document.querySelector('{element}');
                return el ? el.getAttribute('{name}') : null;
            }})()\"\"\")
            return {"value": r.get("result")}"""),
    },
    "is_displayed": {
        "imports": "from ai_dev_browser.core.page import js_exec",
        "body": textwrap.dedent("""\
            r = await js_exec(tab, f\"\"\"(() => {{
                const el = document.querySelector('{element}');
                if (!el) return false;
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
            }})()\"\"\")
            return {"displayed": r.get("result", False)}"""),
    },
}

# Core parameters for each primitive (from spec.md)
CORE_PARAMS = {
    "key_down": [("value", "str", True, "The key value (e.g., 'a', 'Enter', 'Shift')")],
    "key_up": [("value", "str", True, "The key value to release")],
    "pointer_down": [("button", "int", False, "Button: 0=left, 1=middle, 2=right", "0")],
    "pointer_up": [("button", "int", False, "Button: 0=left, 1=middle, 2=right", "0")],
    "pointer_move": [
        ("x", "int", True, "Target X in CSS pixels"),
        ("y", "int", True, "Target Y in CSS pixels"),
        ("duration", "int", False, "Movement time in ms", "0"),
        ("origin", "str", False, 'Reference: "viewport" or "pointer"', '"viewport"'),
    ],
    "scroll": [
        ("x", "int", True, "Scroll origin X"),
        ("y", "int", True, "Scroll origin Y"),
        ("delta_x", "int", True, "Horizontal scroll amount"),
        ("delta_y", "int", True, "Vertical scroll amount"),
        ("duration", "int", False, "Scroll time in ms", "0"),
    ],
    "pause": [("duration", "int", True, "Time in milliseconds")],
    "screenshot": [],
    "get_text": [("element", "str", False, "CSS selector for element (default: whole page)", "None")],
    "get_attribute": [
        ("element", "str", True, "CSS selector for element"),
        ("name", "str", True, "Attribute name"),
    ],
    "is_displayed": [("element", "str", True, "CSS selector for element")],
}

# W3C source section for each primitive
W3C_SOURCES = {
    "key_down": "WebDriver §15.4.1 — Key actions",
    "key_up": "WebDriver §15.4.1 — Key actions",
    "pointer_down": "WebDriver §15.4.2 — Pointer actions",
    "pointer_up": "WebDriver §15.4.2 — Pointer actions",
    "pointer_move": "WebDriver §15.4.2 — Pointer actions",
    "scroll": "WebDriver §15.4.4 — Wheel actions",
    "pause": "WebDriver §15.4.5 — Null actions",
    "screenshot": "WebDriver §18.1 — Take Screenshot",
    "get_text": "WebDriver §12.4.4 — Get Element Text",
    "get_attribute": "WebDriver §12.4.2 — Get Element Attribute",
    "is_displayed": "WebDriver §12.4.8 — Is Element Displayed",
}

KEY_CODES_SNIPPET = """\
_KEY_CODES = {
    "Enter": 13, "Escape": 27, "Tab": 9, "Backspace": 8, "Delete": 46,
    "ArrowUp": 38, "ArrowDown": 40, "ArrowLeft": 37, "ArrowRight": 39,
    "Shift": 16, "Control": 17, "Alt": 18, "Meta": 91,
    " ": 32, "Home": 36, "End": 35, "PageUp": 33, "PageDown": 34,
}
"""

POINTER_STATE_SNIPPET = """\
# Shared pointer position (module-level)
_last_pointer = [0, 0]
"""


def _build_param_str(params):
    """Build function signature params string."""
    parts = ["tab"]
    for p in params:
        name, type_, required = p[0], p[1], p[2]
        default = p[4] if len(p) > 4 else None
        if required:
            parts.append(f"{name}: {type_}")
        else:
            parts.append(f"{name}: {type_} = {default}")
    return ", ".join(parts)


def generate_primitive(name: str) -> str:
    """Generate a primitives/*.py file."""
    source = W3C_SOURCES.get(name, "Unknown")
    impl = CDP_IMPLEMENTATIONS[name]
    params = CORE_PARAMS[name]

    lines = [HEADER.format(source=source)]
    lines.append(impl["imports"])
    lines.append("")

    # Add key codes / pointer state if needed
    if name in ("key_down", "key_up"):
        lines.append(KEY_CODES_SNIPPET)
    if name in ("pointer_down", "pointer_up", "pointer_move"):
        lines.append(POINTER_STATE_SNIPPET)

    # Function
    param_str = _build_param_str(params)
    lines.append(f"async def {name}({param_str}) -> dict:")
    doc = f'    """{source}."""'
    lines.append(doc)
    for line in impl["body"].split("\n"):
        lines.append(f"    {line}")
    lines.append("")

    return "\n".join(lines)


def generate_op(name: str, spec: dict) -> str:
    """Generate an ops/*.py file that wraps the primitive with convenience params."""
    source = W3C_SOURCES.get(name, "Unknown")
    core_params = CORE_PARAMS[name]
    conv_params = spec.get("convenience_params", {})
    hooks = spec.get("hooks", {})

    lines = [HEADER.format(source=source)]
    lines.append(f"from primitives.{name} import {name} as _core")

    # Collect resolver imports
    resolvers = set()
    for cp in conv_params.values():
        if "resolver" in cp:
            resolvers.add(cp["resolver"])
    for h in hooks.values():
        if "resolver" in h:
            resolvers.add(h["resolver"])
    for r in sorted(resolvers):
        mod, func = r.rsplit(".", 1)
        lines.append(f"from {mod} import {func}")

    lines.append("")
    lines.append("")

    # Build function signature
    parts = ["tab"]
    # Core params
    for p in core_params:
        pname, type_, required = p[0], p[1], p[2]
        default = p[4] if len(p) > 4 else None
        if required:
            # If convenience params can resolve this, make it optional
            resolvable = any(pname in cp.get("resolves_to", []) for cp in conv_params.values())
            if resolvable:
                parts.append(f"{pname}: {type_} = None")
            else:
                parts.append(f"{pname}: {type_}")
        else:
            parts.append(f"{pname}: {type_} = {default}")

    # Convenience params
    for cp_name, cp_spec in conv_params.items():
        cp_type = {"string": "str", "bool": "bool", "int": "int", "float": "float"}.get(cp_spec.get("type", "str"), cp_spec.get("type", "str"))
        cp_default = cp_spec.get("default", "None")
        if cp_default is None:
            cp_default = "None"
        elif isinstance(cp_default, bool):
            cp_default = str(cp_default)
        elif isinstance(cp_default, str) and cp_default != "None":
            cp_default = repr(cp_default)
        parts.append(f"{cp_name}: {cp_type} = {cp_default}")

    param_str = ", ".join(parts)
    lines.append(f"async def {name}({param_str}) -> dict:")
    lines.append(f'    """{source}."""')

    # Convenience param resolution
    for cp_name, cp_spec in conv_params.items():
        resolver = cp_spec.get("resolver")
        resolves_to = cp_spec.get("resolves_to")
        if resolver and resolves_to:
            _, func = resolver.rsplit(".", 1)
            targets = ", ".join(resolves_to)
            lines.append(f"    if {cp_name} is not None:")
            lines.append(f"        {targets} = await {func}(tab, {cp_name})")
        elif cp_name == "path" and name == "screenshot":
            # Special: screenshot path handling
            pass
        elif cp_name == "shadow_dom" and name == "get_text":
            # Handled in core
            pass

    # Hooks (e.g., React fallback)
    if "react_fallback" in hooks:
        hook = hooks["react_fallback"]
        _, func = hook["resolver"].rsplit(".", 1)
        hint = hook.get("hint", "")
        lines.append(f"    result = await _core(tab, **{{k: v for k, v in locals().items() if k in _core.__code__.co_varnames and k != 'tab'}})")
        lines.append(f"    if result.get('error'):")
        lines.append(f"        fb = await {func}(tab, value)")
        lines.append(f'        return {{**fb, "hint": "{hint}"}}')
        lines.append(f"    return result")
    else:
        # Build core call with only core params
        core_args = ", ".join(f"{p[0]}={p[0]}" for p in core_params)
        call = f"    result = await _core(tab, {core_args})" if core_args else f"    result = await _core(tab)"

        lines.append(call)

        # Post-processing for screenshot path
        if name == "screenshot" and "path" in conv_params:
            lines.append('    if path is not None and result.get("base64"):')
            lines.append("        import base64 as b64")
            lines.append("        from pathlib import Path as P")
            lines.append("        P(path).parent.mkdir(parents=True, exist_ok=True)")
            lines.append('        P(path).write_bytes(b64.b64decode(result["base64"]))')
            lines.append('        result["saved"] = path')

        lines.append("    return result")

    lines.append("")
    return "\n".join(lines)


def main():
    # Load ops-spec
    with open(OPS_SPEC_PATH) as f:
        ops_spec = yaml.safe_load(f)

    primitives_spec = ops_spec.get("primitives", {})

    # Create directories
    PRIMITIVES_DIR.mkdir(exist_ok=True)
    OPS_DIR.mkdir(exist_ok=True)

    # Write primitives/__init__.py
    (PRIMITIVES_DIR / "__init__.py").write_text(
        "# AUTO-GENERATED — DO NOT EDIT\n"
    )

    # Generate primitives
    generated_primitives = []
    for name in CORE_PARAMS:
        code = generate_primitive(name)
        (PRIMITIVES_DIR / f"{name}.py").write_text(code)
        generated_primitives.append(name)
        print(f"  primitives/{name}.py")

    # Write ops/__init__.py
    (OPS_DIR / "__init__.py").write_text(
        "# AUTO-GENERATED — DO NOT EDIT\n"
    )

    # Keep registry.py (not generated)
    registry_path = OPS_DIR / "registry.py"

    # Generate ops
    generated_ops = []
    for name in CORE_PARAMS:
        spec = primitives_spec.get(name, {})
        code = generate_op(name, spec)
        (OPS_DIR / f"{name}.py").write_text(code)
        generated_ops.append(name)
        print(f"  ops/{name}.py")

    print(f"\nGenerated {len(generated_primitives)} primitives + {len(generated_ops)} ops")


if __name__ == "__main__":
    main()
