# Mio handbook

[简体中文](../README.md) · [Open studio](../../index.html)

## Start

Install Python 3.10+ and run:

```bash
python -m pip install -r packaging/requirements.txt
python server.py
```

Open http://127.0.0.1:8777. Home links to your collections, the creative workshop and provider settings.

## Connect a provider

- **ComfyUI:** enter the service URL, check the connection and import an API workflow.
- **NovelAI:** enter the service URL, model ID and API Key.
- **OpenAI-compatible:** enter the base URL, model ID and API Key, then choose Images API or Chat Completions. Fetch models using the button beside the model field.

## Create

Create a storyboard in the workshop, write a scene and choose character or style presets. Assemble a task and click Start on its card.

## Read and share

Open an album from Collections. Use the reader to edit images, choose a layout or export HTML, image ZIP or PDF.

ComfyUI PNGs carry the full workflow and prompts inside the file. The **Image processing** choice in the export panel applies to all three formats: **Auto** (default) cleans losslessly and falls back to lightweight publishing only when a single HTML file would exceed 128 MiB; **Lossless clean** keeps pixels, resolution and format but removes workflow, prompt and EXIF blocks; **Lightweight publish** re-encodes as high-quality WebP (long edge ≤ 2560 px, never inflating a file); **Lossless archive** writes the originals byte for byte, workflows included — for local backups, not for distribution.

## Undo and the recycle bin

Deleted albums, storyboards, presets, collections, workflows, layouts and plans go to the recycle bin first. For 10 seconds after a deletion, the notification at the bottom of the screen has an **Undo** button.

Later, open **Settings → Data & backup → Recycle bin** to restore an item to its original place or delete it permanently. Items are kept for 30 days by default; you can choose 7 days, 90 days or never. A restore never overwrites an existing file. On disk the recycle bin is the `.trash/` folder in the workspace directory.

## Preferences

Settings contains appearance, language, storage and feature switches. Optional tools include AI writing, visual review and the template market.

[Files](FILE_LIBRARY.md) · [Sharing](CONTENT_AND_SHARING.md) · [Tasks](FOUNDATION.md) · [Mobile](MOBILE.md) · [API](API.md)
