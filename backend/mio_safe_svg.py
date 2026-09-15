"""Validate passive SVG without rendering, rewriting, fetching, or executing it.
Used for retaining the application's existing vector originals during conversion.
"""
import base64
import re
import xml.etree.ElementTree as ET

SVG = 'http://www.w3.org/2000/svg'
XLINK = 'http://www.w3.org/1999/xlink'
XML = 'http://www.w3.org/XML/1998/namespace'
TAGS = set(('svg g path rect circle ellipse line polyline polygon text tspan defs '
            'linearGradient radialGradient stop clipPath mask pattern use symbol title desc '
            'image filter feGaussianBlur feOffset feMerge feMergeNode feColorMatrix '
            'feBlend feComposite feFlood feTurbulence feComponentTransfer feFuncA feFuncR feFuncG feFuncB').split())


def validate_svg(raw):
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('SVG exceeds 8 MiB')
    if re.search(br'<!\s*(?:DOCTYPE|ENTITY)|<\?xml-stylesheet', raw, re.I):
        raise ValueError('SVG declarations and external stylesheets are forbidden')
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise ValueError('Invalid SVG XML') from None
    if root.tag not in ('svg', '{' + SVG + '}svg'):
        raise ValueError('Not an SVG document')
    count = 0
    for node in root.iter():
        count += 1
        if count > 100000:
            raise ValueError('SVG contains too many elements')
        namespace, _, tag = node.tag.rpartition('}')
        if (namespace and namespace != '{' + SVG) or tag not in TAGS:
            raise ValueError('Unsupported or active SVG element')
        if tag == 'feTurbulence' and (not node.get('numOctaves','1').isdigit() or not 1 <= int(node.get('numOctaves','1')) <= 8):
            raise ValueError('SVG turbulence octave count exceeds the safe limit')
        for name, value in node.attrib.items():
            ns, _, local = name.rpartition('}')
            if ns and ns not in ('{' + XLINK, '{' + XML):
                raise ValueError('Unsupported SVG attribute namespace')
            if local.lower().startswith('on') or local in ('base', 'src'):
                raise ValueError('Active SVG attributes are forbidden')
            if local == 'href':
                if value.startswith('#') and re.fullmatch(r'#[\w:.-]+', value):
                    continue
                if tag == 'image' and value.startswith(('data:image/png;base64,', 'data:image/jpeg;base64,', 'data:image/webp;base64,')):
                    try:
                        decoded = base64.b64decode(value.split(',', 1)[1], validate=True)
                    except (ValueError, TypeError):
                        raise ValueError('Invalid embedded raster image') from None
                    if not (decoded.startswith(b'\x89PNG\r\n\x1a\n') or decoded.startswith(b'\xff\xd8\xff') or decoded[:4] == b'RIFF' and decoded[8:12] == b'WEBP'):
                        raise ValueError('SVG embedded content is not a raster image')
                    continue
                raise ValueError('SVG references must be internal fragments or embedded raster images')
            if any(character in value for character in ('\\', '@', '\x00')) or re.search(r'(?:javascript|https?|file|data|vbscript)\s*:|expression\s*\(', value, re.I):
                raise ValueError('External or executable SVG attribute value')
            for match in re.finditer(r'url\s*\((.*?)\)', value, re.I):
                if not re.fullmatch(r'[\s\'"]*#[\w:.-]+[\s\'"]*', match.group(1)):
                    raise ValueError('External SVG paint reference')
    return raw
