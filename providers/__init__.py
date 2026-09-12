"""Versioned, built-in adapter registry; no arbitrary plugin execution."""
import re
from . import cloud, comfyui, openai_images, openai_chat, novelai
PROTOCOLS = {'openai:images': 'Images multipart/JSON', 'openai:chat': 'Chat multimodal',
             'novelai:images': 'NovelAI generate-image', 'comfyui:workflow': 'ComfyUI API graph'}
RESERVED = {'model', 'prompt', 'input', 'messages', 'image', 'images', 'image[]', 'n',
            'stream', 'action', 'parameters', 'source', 'headers', 'workflow', 'apikey', 'api_token', 'token', 'reference_image_multiple',
            'reference_information_extracted_multiple', 'reference_strength_multiple',
            'v4_prompt', 'v4_negative_prompt', 'negative_prompt', 'authorization', 'api_key', 'key'}

def extras(config, body):
    extra = config.get('extraParams', {})
    if not isinstance(extra, dict) or len(extra) > 100:
        raise ValueError('extraParams must be an object of at most 100 fields')
    import json
    if len(json.dumps(extra)) > 65536:
        raise ValueError('extraParams exceeds 64 KiB')
    if any(not isinstance(k, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_.-]{0,95}',k) or k.lower() in RESERVED or k in body or k.startswith('_') for k in extra):
        raise ValueError('extraParams cannot replace bound prompts, images, credentials or standard parameters')
    body.update(extra)
    return list(extra)

def generate(payload, host):
    return _generate(payload, host)

def _generate(payload, host):
    provider = (payload.get('config') or {}).get('provider')
    if provider == 'comfyui':
        result = comfyui.generate(payload, host)
    else:
        # Legacy host utilities remain injectable for deterministic transport tests.
        # Copy into a fresh function namespace, never mutate module globals during requests.
        import types
        namespace = dict(vars(host));namespace['apply_provider_extras'] = extras
        result = types.FunctionType(cloud.generate.__code__, namespace)(payload)
    result.setdefault('artifacts', [{'kind': 'image', 'url': result['image']}])
    if hasattr(host,'mio_foundation'):
        for artifact in result['artifacts']:host.mio_foundation.record_asset_origin(host,artifact['url'],{'kind':'generation','provider':provider,'model':str(payload.get('config',{}).get('model',''))})
    result['contractVersion'] = 1
    return result


BUILDERS={('openai','images'):openai_images.build,('openai','chat'):openai_chat.build,('novelai','images'):novelai.build}
def build_request(context):
    config=context['config'];key=(config['provider'],config.get('protocol','images'))
    if key not in BUILDERS:raise ValueError('Unsupported protocol; no automatic protocol fallback')
    return BUILDERS[key](context)
