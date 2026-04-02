---
name: image-analysis
description: "Analyze, describe, or answer questions about image content using vision AI. Use this skill when the user asks anything about an image — what it shows, what's in it, reading text/diagrams, identifying objects, or any question referencing a previous image (e.g. 'what is in this image', 'read the text in this screenshot', 'explain this diagram', 'tell me about the image above', '识别图片', '分析图片内容')."
---

# Image Analysis Skill

Analyze images via LLM provider's chat completions API with vision.

## When to Use

Trigger this skill when the user asks to:
- Describe or analyze an image ("describe this image", "what's in this picture")
- Recognize content in an image ("识别图片", "分析图片内容")
- Extract text from an image (OCR) ("read the text in this screenshot")
- Answer questions about an image ("how many people are in this photo", "what color is the car")
- Reference a previous image ("tell me about the image above", "what's in the previous picture")
- Explain visual content ("explain this diagram", "what does this chart show")
- Identify objects ("what kind of plant is this", "identify this")

## Steps

### Step 1: Identify the image

Get the image from the user's message or workspace context.

- If the user provides a **local file path**, use it directly.
- If the user provides an **image URL** (http/https), ask the user whether they'd like to download the image to a local file first, then download it (e.g. with `curl -sL "<url>" -o /tmp/image_to_analyze.<ext>`) before proceeding.
- If the user references a **previous image** without a path (e.g. "the above image", "the image I just sent"), search the workspace directory for recent image files:
  1. List files in the workspace matching common image extensions (`*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`, `*.bmp`)
  2. Sort by modification time (most recent first)
  3. Use the most recent image. If there are multiple candidates and it's ambiguous, ask the user which image they mean.

### Step 2: Run the image analysis script

```bash
bash scripts/analyze_image.sh "<image_path>" "<question or prompt>"
```

The script reads API credentials and model from `sudoclaw.json` via the `OPENCLAW_CONFIG_PATH` env var (auto-set at gateway startup). No manual env var configuration is needed.

The script prints the analysis result (LLM response) on success, or an error message on failure.

### Step 3: Show the result

Display the analysis result to the user.
