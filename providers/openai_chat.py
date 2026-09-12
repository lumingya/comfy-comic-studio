"""Built-in openai_chat request builder; no transport or UI dependencies."""
import base64
import secrets

def build(context):
    config=context['config'];model=context['model'];prompt=context['prompt'];negative=context['negative']
    number=context['number'];source_raw=context['source_raw'];ordered_images=context['ordered_images'];image_values=context['image_values']
    content = [{'type': 'text', 'text': prompt + ('\nAvoid: ' + negative if negative else '')}]
    for image_url, _ in ordered_images:
        content.append({'type': 'image_url', 'image_url': {'url': image_url}})
    body = {'model': model, 'messages': [{'role': 'user', 'content': content}], 'stream': False}
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
            elif url not in fallback:fallback.append(url)
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
