"""Offline documentation rendering. No runtime network or third-party Python deps."""
import json
from pathlib import Path
import urllib.parse


def render_document(root, relative, source=None):
    root = Path(root)
    path = root / relative
    text = path.read_text(encoding='utf-8-sig') if source is None else source
    template = (root / 'docs/reader-template.html').read_text(encoding='utf-8')
    # JSON data must never be able to terminate its script element.
    payload = json.dumps({'markdown': text, 'path': relative.as_posix() if isinstance(relative, Path) else str(relative),
                          'english': '/en/' in '/' + str(relative) or str(relative).endswith('.en.md')}, ensure_ascii=False)
    payload = payload.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
    prefix = '../' * (len(Path(relative).parts) - 1)
    template = template.replace('__HOME__', prefix + 'docs/index.html').replace('__APP__', prefix + 'index.html')
    template = template.replace('__SOURCE__', urllib.parse.quote(Path(relative).name)).replace('__DOC_DATA__', payload)
    template = template.replace('__MARKED__', (root / 'vendor/marked.min.js').read_text(encoding='utf-8'))
    template = template.replace('__PURIFY__', (root / 'vendor/purify.min.js').read_text(encoding='utf-8'))
    return template


def source_documents(root):
    root = Path(root)
    return [root / name for name in ('README.md', 'README.en.md', 'SECURITY.md')] + sorted((root / 'docs').rglob('*.md'))


def build(root):
    root = Path(root)
    count = 0
    for path in source_documents(root):
        path.with_suffix('.html').write_text(render_document(root, path.relative_to(root)), encoding='utf-8')
        count += 1
    return count
