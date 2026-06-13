# Channel voice → text transcription — design

Date: 2026-06-13
Status: design agreed; implementation not started. Implement FIRST (no external blockers).
Owner: sudowork channels/gateway team
Related code: `src/channels/gateway/ActionExecutor.ts`, `src/channels/plugins/*/`, `src/process/services/python/PythonRuntimeService.ts`

## 1. Problem

Inbound voice messages (personal WeChat etc.) currently reach the agent as just an audio file path + `[voice message]` placeholder — the model can't hear it, so voice is effectively dead. Add transcription so voice arrives as text.

## 2. Data flow (confirmed)

```
personal WeChat (iLink Bot API, bot_type=3)
   │  receive + download + AES-decrypt voice from CDN → local SILK file
   ▼
sudowork  ── WeChat plugin: WeChatApiClient (recv), WeChatAdapter (getMediaExtract → download)
   │  ── gateway ActionExecutor: isMediaContentType('voice') → bundles file path + placeholder
   ▼  (ACP / AcpAgent, [[NEXUS_FILES]] → content blocks)
sudocode  ── agent engine
```

Personal WeChat connects to **sudowork**, not sudocode. WeChat's built-in 转文字 is NOT available via the bot API — `VoiceItem` (wechat/types.ts) has only `media / voice_length / voice_format`, no recognition field. So we transcribe ourselves from raw SILK.

## 3. Architecture — shared TranscriptionService at the gateway

- Media **download** is per-adapter (WeChat=SILK, DingTalk=AMR, …) — stays per-adapter.
- Media→AI handling is **shared** in `ActionExecutor.ts` (`isMediaContentType` covers 'voice'/'audio' for all platforms).

So build a **shared `TranscriptionService`**: `transcribe(audioPath, codec) → text`, hooked into the gateway voice branch. Then personal WeChat + WeCom (`WeComPlugin`) + DingTalk all benefit. The per-channel adapter supplies only the `codec` (it already has `voice_format`). **Do NOT bury transcription in the WeChat plugin.**

Replace the `[voice message]` placeholder with the transcript (optionally keep the audio file attached too).

## 4. ASR engine

- **Local default, pluggable, CPU-only** — WeChat voice clips are short (<60s), no GPU needed.
- NOT the old slow OpenAI whisper reference impl. Use **faster-whisper** (CTranslate2, CPU int8) or, better for Chinese, **SenseVoice / FunASR** (Alibaba — faster + stronger Chinese). Pick during PoC by transcription-quality on real WeChat clips.
- **Rides the existing provisioned Python runtime** (`PythonRuntimeService`, already there for ai-dev-browser) — ASR is a pip package; no new runtime burden.
- **SILK → wav** decode via `pilk` (pip) or bundled ffmpeg, then feed ASR.
- **Cloud ASR fallback** for weak machines / users who can't run local (tradeoff: audio leaves device — privacy). Make the engine an interface so local↔cloud is a config switch.
- First-run **lazy model download** (faster-whisper base ~140MB, SenseVoice-small ~900MB).

## 5. Rollout & constraints (user-imposed — must honor)

Making it shared raises the test/ops cost; honor these:
- **Per-channel incremental enablement, each gated by its own CI integration test** — don't flip transcription on for a channel without CI coverage, or we risk regressing that channel. Start: **personal WeChat + its CI integration**; add WeCom/DingTalk later, each with its own integration test.
- **Notify 飞书 Engineering** about this cross-channel change — draft a Feishu notice when the design/PR is concrete (same FYI pattern as the Mode A channel-timeout fix). Don't broadcast prematurely.
- Don't break other channels: the shared service must be a no-op for channels not yet enabled.

## 6. PoC → production

- **PoC**: wire the shared `TranscriptionService` and call it only from the WeChat voice path; validate SILK → ASR → text quality on real clips; pick faster-whisper vs SenseVoice.
- **Production**: keep it as the shared service; add the WeChat CI integration test; then extend per-channel with CI each.

## 7. Tests

- Unit: SILK→wav decode; engine interface (local + mocked cloud).
- Integration (per channel, CI): a voice message → transcript appears as the agent input text; channel doesn't break when ASR fails (graceful fallback to "[voice message]" + file).
