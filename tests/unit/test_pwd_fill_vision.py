"""Regression tests for the auto-login filler's captcha vision-model resolution.

Guards the bug where captcha OCR used agents.defaults.imageModel (an image
GENERATION / diffusion model) instead of a vision-capable CHAT model. Run with:

    python -m pytest tests/unit/test_pwd_fill_vision.py
    # or plainly:
    python tests/unit/test_pwd_fill_vision.py
"""

import importlib.util
import json
import os
import tempfile

_SPEC = importlib.util.spec_from_file_location(
    "pwd_fill",
    os.path.join(os.path.dirname(__file__), "..", "..", "resources", "pwdLogin", "pwd_fill.py"),
)
pf = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(pf)


def _cfg_with(sudoclaw: dict) -> dict:
    fd, path = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sudoclaw, f)
    return {"sudoclawConfigPath": path}


_SUDOROUTER = {
    "baseUrl": "https://hk.sudorouter.ai/v1",
    "apiKey": "k",
    "models": [
        {"id": "gpt-5.5", "input": ["text"]},
        {"id": "grok-4.3", "input": ["text"]},
        {"id": "gemini-3.5-flash", "input": ["text", "image"]},
        {"id": "claude-opus-4-8", "input": ["text", "image"]},
    ],
}


def _config(primary: str) -> dict:
    return {"models": {"providers": {"sudorouter": _SUDOROUTER}}, "agents": {"defaults": {"model": {"primary": primary}}}}


def test_uses_session_model_when_vision_capable():
    v = pf._resolve_vision(_cfg_with(_config("sudorouter-gemini-3.5-flash/gemini-3.5-flash")))
    assert v["model"] == "gemini-3.5-flash"
    assert v["baseUrl"] == "https://hk.sudorouter.ai/v1"


def test_falls_back_to_vision_model_when_session_is_text_only():
    # gpt-5.5 is text-only → must fall back to a vision-capable model (gemini/claude).
    v = pf._resolve_vision(_cfg_with(_config("sudorouter-gpt-5.5/gpt-5.5")))
    assert v["model"] in ("gemini-3.5-flash", "claude-opus-4-8")
    assert v["model"] != "gpt-5.5"


def test_never_uses_image_generation_model():
    # Even if a (diffusion) imageModel is present, captcha must use a vision chat model.
    cfg = _config("sudorouter-gemini-3.5-flash/gemini-3.5-flash")
    cfg["agents"]["defaults"]["imageModel"] = "gpt-image-1.5"
    v = pf._resolve_vision(_cfg_with(cfg))
    assert v["model"] != "gpt-image-1.5"
    assert v["model"] == "gemini-3.5-flash"


def test_explicit_vision_override_wins():
    cfg = {"vision": {"baseUrl": "http://x", "apiKey": "y", "model": "pinned-vision"}, **_cfg_with(_config("sudorouter-gpt-5.5/gpt-5.5"))}
    v = pf._resolve_vision(cfg)
    assert v["model"] == "pinned-vision"


if __name__ == "__main__":
    test_uses_session_model_when_vision_capable()
    test_falls_back_to_vision_model_when_session_is_text_only()
    test_never_uses_image_generation_model()
    test_explicit_vision_override_wins()
    print("ALL PASS")
