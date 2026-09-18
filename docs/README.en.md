<div align="center">
  <img src="assets/mio-banner.svg" alt="Mio — Stories in frames" width="900">
  <h1>Mio</h1>
  <p>One story. Many frames. Your own book.</p>
</div>

Mio is a local workspace for storyboards, image generation, illustrated books and image editing. It supports ComfyUI, NovelAI and OpenAI-compatible image services.

[Handbook](en/GUIDE.md) · [Documentation](index.html) · [简体中文](../README.md)

## Start

Requires Python 3.10+, Pillow 11.3–12.x and a modern browser. Computed variables also require Node.js 20+; installing extensions from Git requires Git.

Run from the project directory:

```bash
python -m pip install -r packaging/requirements.txt
python server.py
```

Open **http://127.0.0.1:8777**. On Windows, use `start.bat`; on Linux/macOS, use `sh start.sh`.

The default workspace is `data/`. Set `MIO_DATA_DIR` to use another directory. Back up your workspace before replacing the application.

## Create a book

1. Open Workflow & API setup from Home and configure an image channel.
2. In the Creation workshop, create a storyboard with image prompts and dialogue.
3. Prepare character, outfit, style or image variables in the preset library.
4. Combine storyboards and presets using the assembly wizard or node canvas, then add a generation task.
5. Click Start on the task card and follow scene progress.
6. Open Collections to read, edit images or export your work.

## Reading and export

The reader offers presentation templates, bubble and text editing, and HTML, image ZIP and PDF exports.

[Handbook](en/GUIDE.md) · [Content and sharing](en/CONTENT_AND_SHARING.md) · [Workspace files](en/FILE_LIBRARY.md)

## Development

```bash
npm ci
npx playwright install chromium
npm run build
npm run test:current
```

[Development guide](DEVELOPMENT.md) · [External API](en/API.md) · [OpenAPI](api/openapi.json) · [MIT License](../LICENSE)
