"""Built-in novelai request builder; no transport or UI dependencies."""
import base64
import secrets

def build(context):
    config=context['config'];model=context['model'];prompt=context['prompt'];negative=context['negative']
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
    if 'diffusion-4' in model or 'diffusion-5' in model:
        params.update({'v4_prompt': {'caption': {'base_caption': prompt, 'char_captions': []}, 'use_coords': False, 'use_order': True},
                       'v4_negative_prompt': {'caption': {'base_caption': negative, 'char_captions': []}}, 'characterPrompts': []})
    if source_raw:
        params.update(image=base64.b64encode(source_raw).decode(), strength=number('denoise', .45, 0, 1), noise=0)
    if image_values:
        references = ordered_images[:-1] if source_raw else ordered_images
        params.update(reference_image_multiple=[base64.b64encode(raw).decode() for _, raw in references],
                      reference_information_extracted_multiple=[1.0] * len(references),
                      reference_strength_multiple=[0.6] * len(references))
    body = {'input': prompt, 'model': model, 'action': 'img2img' if source_raw else 'generate', 'parameters': params}
    path = '/ai/generate-image'
    return path, body
