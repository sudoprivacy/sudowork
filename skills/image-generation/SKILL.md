---
name: image-generation
description: "Generate new images or edit existing images using AI. Use this skill when the user wants to create, generate, draw, design, or produce an image from a text description, OR when they want to modify, edit, alter, or transform an existing image (e.g. 'generate a picture of...', 'create an image', 'draw me a...', 'edit this image', 'change the background', 'modify the above picture', '生成图片', '画一张', '修改图片', '编辑上面的图')."
---

# Image Generation Skill

Generate new images or edit existing images via the images API.

## When to Use

Trigger this skill when the user asks to:
- Generate / create / draw / design a new image ("generate an image of a cat", "draw me a sunset")
- Edit / modify / alter an existing image ("change the background to white", "add a hat to the person")
- Transform a referenced image ("make the above image black and white", "修改上面的图片")

## Steps

### Step 1: Determine operation type

- **Generation**: User describes a new image to create (no source image referenced)
- **Edit**: User references an existing image to modify

### Step 2: For edits — identify the source image

- If the user provides a **local file path**, use it directly.
- If the user provides an **image URL** (http/https), download it first:
  ```bash
  curl -sL "<url>" -o /tmp/source_image.<ext>
  ```
- If the user references a **previous image** without a path (e.g. "the above image", "上面的图"):
  1. List files in the workspace matching common image extensions (`*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.webp`, `*.bmp`)
  2. Sort by modification time (most recent first)
  3. Use the most recent image. If there are multiple candidates and it's ambiguous, ask the user which image they mean.

### Step 3: Run the image generation script

**For generation (new image):**
```bash
bash scripts/generate_image.sh gen "<prompt>" [size]
```

**For editing (modify existing image):**
```bash
bash scripts/generate_image.sh edit "<prompt>" "<image_path>" [size]
```

- `size` is optional, defaults to `1024x1024`. Common sizes: `1024x1024`, `1024x1536`, `1536x1024`.
- The script reads API credentials and image model from `sudoclaw.json` via `OPENCLAW_CONFIG_PATH`. No manual configuration needed.
- The image model is read from `sudoclaw.json` (set via Tools settings). If not configured, the script will report an error asking the user to set the image model in Tools settings.

The script prints the saved image file path on success, or an error message on failure.

### Step 4: Show the result

Display the generated/edited image to the user. Show the file path so they can find it.
