"""Force the app UI language to a deterministic locale for the run.

Text-based selectors (`mouse_click text: "Skill Store"`) and content judges
resolve against whatever language the app happens to be in. On a user's
Chinese install an English-label case silently misses every button. A
regression gate cannot depend on the ambient setting, so each case declares
its `locale` (runner default `en-US`) and this op pins the app to it before
the case drives the UI.

Two writes, because language lives in two places:

  1. ConfigStorage key `language` — the single source of truth the renderer
     reads on boot (packages/renderer/src/i18n/index.ts initLanguage). Persisted to
     disk here so a mid-case `restart_app` comes back in the same language;
     the main-process `system-settings:change-language` handler does NOT
     persist (it only broadcasts + updates main i18n).
  2. The live renderer — switched with no reload by invoking that same
     change-language provider over the app's own CDP bridge. Its
     `languageChanged` broadcast drives the renderer's `ensureAndSwitch`,
     which lazy-loads the target locale bundle. Idempotent: a no-op when the
     app is already on the target language.
"""

from ._enterprise_config import set_config_value

# ConfigStorage SSOT key (src/common/storage.ts) + the live-switch provider
# channel (src/common/ipcBridge.ts systemSettings.changeLanguage).
_LANGUAGE_KEY = "language"
_CHANGE_LANGUAGE_CHANNEL = "system-settings:change-language"


async def set_locale(tab, language: str = "en-US", timeout: float = 10) -> dict:
    """Pin the app UI language to `language` (e.g. "en-US", "zh-CN").

    Returns:
        {"pass": True, "language": ...} once the renderer is on the target.
        {"pass": False, "reason": ...} if the live switch did not take.
    """
    # 1. Persist the SSOT so a later restart_app boots in this language.
    set_config_value(_LANGUAGE_KEY, language)

    # 2. Live-switch the running renderer and confirm via the localStorage
    #    hint the renderer writes once the switch completes.
    js = f"""(async () => {{
      const target = {language!r};
      if (localStorage.getItem('i18nextLng') === target) return {{ switched: true, already: true }};
      const e = window.__bridgeEmitter;
      if (!e || !window.electronAPI) return {{ error: 'no CDP bridge emitter (renderer not ready?)' }};
      const ch = {_CHANGE_LANGUAGE_CHANNEL!r};
      const id = ch + '_' + Date.now();
      const key = 'subscribe.callback-' + ch + id;
      await new Promise((resolve) => {{
        const h = () => {{ e.off(key, h); resolve(); }};
        e.on(key, h);
        window.electronAPI.emit('subscribe-' + ch, {{ id, data: {{ language: target }} }});
        setTimeout(() => {{ e.off(key, h); resolve(); }}, 5000);
      }});
      for (let i = 0; i < 50; i++) {{
        if (localStorage.getItem('i18nextLng') === target) return {{ switched: true }};
        await new Promise(r => setTimeout(r, 100));
      }}
      return {{ switched: false, current: localStorage.getItem('i18nextLng') }};
    }})()"""

    r = await tab.evaluate(js, await_promise=True, return_by_value=True, timeout=timeout)

    if isinstance(r, dict) and r.get("switched"):
        return {"pass": True, "language": language, "already": bool(r.get("already"))}

    reason = (
        (r.get("error") or f"language did not switch to {language} (current={r.get('current')})")
        if isinstance(r, dict)
        else f"unexpected set_locale result: {r}"
    )
    return {"pass": False, "reason": reason, "language": language}
