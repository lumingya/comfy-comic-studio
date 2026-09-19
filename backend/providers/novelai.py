"""Built-in novelai request builder; no transport or UI dependencies.

V3 models accept raw reference images. V4/V4.5 models only accept vibe tokens
produced by /ai/encode-vibe, so the builder asks the transport-supplied
``encode_vibe`` callback for them (the caller caches tokens; each fresh
encoding costs Anlas).
"""
import base64
import re
import secrets

# NovelAI tuning flags a channel may override through extraParams.
TUNABLE = ('qualityToggle', 'ucPreset', 'sm', 'sm_dyn', 'dynamic_thresholding', 'noise_schedule')
IMAGE_TOKEN = re.compile(r'@image_\d+')


def is_v4(model):
    return any(tag in model for tag in ('diffusion-4', 'diffusion-5'))


def clean_prompt(text):
    """Drop @image_N placeholders: NovelAI binds references by parameter, not by prompt."""
    if not isinstance(text, str) or '@image_' not in text:
        return text
    cleaned = IMAGE_TOKEN.sub('', text)
    cleaned = re.sub(r'[ \t]*,(?:[ \t]*,)+', ',', cleaned)
    cleaned = re.sub(r'[ \t]{2,}', ' ', cleaned)
    return re.sub(r'^[ \t,]+|[ \t,]+$', '', cleaned, flags=re.M)


def build(context):
    config=context['config'];model=context['model'];prompt=clean_prompt(context['prompt']);negative=clean_prompt(context['negative'])
    number=context['number'];source_raw=context['source_raw'];ordered_images=context['ordered_images'];image_values=context['image_values']
    width, height = int(number('width', 768, 64, 2048)), int(number('height', 1024, 64, 2048))
    if width % 64 or height % 64:
        raise ValueError('NovelAI width and height must be multiples of 64')
    seed = int(number('seed', -1, -1, 4294967295))
    params = {'params_version': 3, 'width': width, 'height': height, 'scale': number('cfg', 5, 0, 10),
              'steps': int(number('steps', 28, 1, 50)), 'seed': seed if seed >= 0 else secrets.randbelow(4294967296),
              'n_samples': 1, 'sampler': config.get('sampler', 'k_euler_ancestral'), 'noise_schedule': 'karras',
              'negative_prompt': negative, 'ucPreset': 0, 'qualityToggle': False, 'sm': False, 'sm_dyn': False,
              'dynamic_thresholding': False, 'controlnet_strength': 1, 'legacy': False, 'add_original_image': True}
    extra = config.get('extraParams') if isinstance(config.get('extraParams'), dict) else {}
    for key in TUNABLE:
        if key in extra:
            params[key] = extra[key]
    if is_v4(model):
        params.update({'v4_prompt': {'caption': {'base_caption': prompt, 'char_captions': []}, 'use_coords': False, 'use_order': True},
                       'v4_negative_prompt': {'caption': {'base_caption': negative, 'char_captions': []}}, 'characterPrompts': []})
    if source_raw:
        params.update(image=base64.b64encode(source_raw).decode(), strength=number('denoise', .45, 0, 1), noise=0)
    if image_values:
        references = ordered_images[:-1] if source_raw else ordered_images
        strength = [0.6] * len(references)
        if is_v4(model):
            encode = context.get('encode_vibe')
            if not callable(encode):
                raise ValueError('NovelAI V4 reference images need vibe encoding support')
            # V4 takes pre-encoded vibe tokens; information_extracted is fixed at
            # encoding time, so the per-image array is omitted here.
            params.update(reference_image_multiple=[encode(raw, 1.0) for _, raw in references],
                          reference_strength_multiple=strength)
        else:
            params.update(reference_image_multiple=[base64.b64encode(raw).decode() for _, raw in references],
                          reference_information_extracted_multiple=[1.0] * len(references),
                          reference_strength_multiple=strength)
    body = {'input': prompt, 'model': model, 'action': 'img2img' if source_raw else 'generate', 'parameters': params}
    path = '/ai/generate-image'
    return path, body
