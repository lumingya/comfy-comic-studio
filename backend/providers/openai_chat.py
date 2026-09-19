"""Built-in openai_chat request builder; no transport or UI dependencies."""
import base64
import secrets

def aspect_hint(frame):
    """Describe the frame's aspect ratio in words for chat models without a size field.

    Square frames get a hint too (C6): several multimodal models default to a
    landscape canvas when the prompt is silent about shape.
    """
    try:
        width, height = int(float(frame.get('width') or 0)), int(float(frame.get('height') or 0))
    except (TypeError, ValueError):
        return ''
    if width <= 0 or height <= 0:
        return ''
    from math import gcd
    g = gcd(width, height)
    ratio = str(width // g) + ':' + str(height // g)
    orientation = 'square' if width == height else 'portrait' if height > width else 'landscape'
    return 'Output a single ' + orientation + ' image with aspect ratio ' + ratio + ' (' + str(width) + 'x' + str(height) + ').'


def build(context):
    config=context['config'];model=context['model'];prompt=context['prompt'];negative=context['negative']
    number=context['number'];source_raw=context['source_raw'];ordered_images=context['ordered_images'];image_values=context['image_values']
    text = prompt + ('\nAvoid: ' + negative if negative else '')
    # C5: the Chat protocol has no size field, so the aspect ratio travels as a
    # sentence in the prompt. It has its own switch (sendAspectHint, default
    # on) instead of borrowing the Images-API `sendSize` flag that the settings
    # UI disables for Chat.
    hint = aspect_hint(context.get('frame') or {}) if config.get('sendAspectHint', True) else ''
    if hint:
        text += '\n' + hint
    content = [{'type': 'text', 'text': text}]
    for image_url, _ in ordered_images:
        content.append({'type': 'image_url', 'image_url': {'url': image_url}})
    # Gateways (OpenRouter, one-api, new-api) route Gemini/GPT image models
    # through chat/completions and answer text-only unless image output is
    # requested explicitly.
    body = {'model': model, 'messages': [{'role': 'user', 'content': content}], 'stream': False, 'modalities': ['image', 'text']}
    path = '/chat/completions'
    return path, body


def text_image_urls(text):
    """Accept inline Markdown destinations, autolinks and bare URLs in source order.

    Do not require a filename extension: signed/download endpoints often lack one.
    Bytes are validated by the transport; this is extraction, not image validation.
    """
    import re
    urls = []
    pattern = r'data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+|https?://[^\s<>"\x27`\[\]]+'
    for match in re.finditer(pattern, text):
        url = match.group()
        if not url.startswith('data:'):
            # An unmatched closing parenthesis ends a Markdown destination or
            # prose wrapper. Balanced parentheses inside the URL are preserved.
            chars = []; depth = 0; i = 0
            while i < len(url):
                char = url[i]
                if char == '\\' and i + 1 < len(url) and url[i + 1] in '()':
                    chars.append(url[i + 1]); i += 2; continue
                if char == '(':
                    depth += 1
                elif char == ')':
                    if depth == 0:break
                    depth -= 1
                chars.append(char); i += 1
            url = ''.join(chars).rstrip('.,;!，。；！：、')
        if url and url not in urls:urls.append(url)
    return urls


# Links that a model drops into prose while declining are documentation, not
# renders: a bare site root or an HTML page can never be the generated image.
_PAGE_SUFFIXES = ('.html', '.htm', '.php', '.asp', '.aspx', '.md', '.pdf')


def looks_like_page(url):
    """True for URLs that cannot plausibly be an image download (C4)."""
    from urllib.parse import urlsplit
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    path = parts.path or ''
    if not parts.query and (path in ('', '/') or path.endswith('/')):
        # Site roots and directory indexes ("/policies/") are pages, never files.
        return True
    return path.lower().endswith(_PAGE_SUFFIXES)


def message_text(message):
    """The model's own words, so a refusal can be shown instead of a download error."""
    chunks = []
    if not isinstance(message, dict):
        return ''
    refusal = message.get('refusal')
    if isinstance(refusal, str) and refusal.strip():
        chunks.append(refusal.strip())
    content = message.get('content')
    if isinstance(content, str):
        chunks.append(content)
    elif isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and isinstance(block.get('text'), str):
                chunks.append(block['text'])
            elif isinstance(block, dict) and isinstance(block.get('refusal'), str):
                chunks.append(block['refusal'])
    import re
    text = '\n'.join(c for c in chunks if c and c.strip())
    # Drop inline data URLs so a base64 blob never masquerades as prose.
    text = re.sub(r'data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+', '[image]', text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def extract_images(message):
    """Normalize common Chat response variants without losing text blocks."""
    import re
    urls = []; fallback = []
    def add_text(text):
        # Explicit image markup wins over incidental website/documentation links.
        markdown = []
        for match in re.finditer(r'!\[(?:\\.|[^\]\\])*\]\(\s*<?((?:https?://|data:image/)[^\s>]+)', text):
            markdown.extend(text_image_urls(match.group(1)))
        for url in text_image_urls(text):
            if url in markdown or url.startswith("data:image/"):add(url)
            elif url not in fallback and not looks_like_page(url):fallback.append(url)
    def add(value):
        if isinstance(value, dict):value = value.get('url')
        if isinstance(value, str) and value and value not in urls:urls.append(value)
    for image in message.get('images') or []:
        if isinstance(image, dict):add(image.get('image_url') or image.get('url'))
        elif isinstance(image, str):add(image)
    content = message.get('content')
    if isinstance(content, str):
        add_text(content)
    elif isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):continue
            if block.get('type') in ('image_url', 'image'):add(block.get('image_url') or block.get('url'))
            elif isinstance(block.get('text'), str):
                add_text(block['text'])
    return [{'url': url} for url in (urls or fallback)]


class ModelTextResponse(ValueError):
    """The chat model answered with words instead of an image (C4).

    Carries the model's own reply so the task card can show the real reason
    (moderation, unsupported model, quota…) instead of a generic download error.
    """

    PREFIX = '模型没有返回图片，而是回复了文字'
    DOWNLOAD_PREFIX = '模型回复中的链接无法作为图片下载'

    def __init__(self, text, download_error=''):
        self.model_text = (text or '').strip()
        self.download_error = str(download_error or '')
        excerpt = self.model_text[:400] + ('…' if len(self.model_text) > 400 else '')
        if self.download_error:
            message = self.DOWNLOAD_PREFIX + '（' + self.download_error[:160] + '）。模型原文：' + (excerpt or '（空）')
        else:
            message = self.PREFIX + '：' + (excerpt or '（空回复）')
        super().__init__(message)
