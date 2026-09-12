"""Built-in openai_images request builder; no transport or UI dependencies."""
import base64
import secrets

def build(context):
    config=context['config'];model=context['model'];prompt=context['prompt'];negative=context['negative']
    number=context['number'];source_raw=context['source_raw'];ordered_images=context['ordered_images'];image_values=context['image_values']
    body = {'model': model, 'prompt': prompt + ('\nAvoid: ' + negative if negative else ''), 'n': 1}
    if config.get('sendSize', True) and config.get('size'):
        body['size'] = config['size']
    if config.get('sendQuality', True) and config.get('quality'):
        body['quality'] = config['quality']
    path = '/images/edits' if ordered_images else '/images/generations'
    return path, body
