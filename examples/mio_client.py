#!/usr/bin/env python3
"""Mio stdlib client. No automatic retries; generation can incur charges.

  export MIO_API_TOKEN=...             # same token as the Mio server
  python examples/mio_client.py        # non-billable capabilities query
  python examples/mio_client.py --provider-id openai --prompt "A quiet bookshop" --output page.png

The selected provider must have been saved in Mio. For generation, set
MIO_PROVIDER_KEY here or the matching provider environment variable on the server.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import urllib.error
import urllib.request
import urllib.parse


class MioClient:
    def __init__(self, base_url='http://127.0.0.1:8777', token=None):
        self.base_url = base_url.rstrip('/')
        self.token = token or os.environ.get('MIO_API_TOKEN', '')
        if not self.token:
            raise ValueError('Set MIO_API_TOKEN')
        parsed = urllib.parse.urlparse(self.base_url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname:
            raise ValueError('Use an HTTP(S) Mio server URL')
        if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('Use HTTPS for non-loopback connections')

    def request(self, path, body=None):
        if not path.startswith('/api/v1/') or '..' in path:
            raise ValueError('Only Mio v1 relative endpoints are allowed')
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base_url + path, data=data, headers={
            'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        # Protect the token from accidental redirects to a different service.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        try:
            with urllib.request.build_opener(NoRedirect).open(req, timeout=360) as response:
                result = json.load(response)
        except urllib.error.HTTPError as exc:
            try:
                error = json.load(exc)
                raise RuntimeError(f"Mio HTTP {exc.code}: {error.get('error', {}).get('code', 'unknown')} / {error.get('requestId', '')}") from None
            except (ValueError, AttributeError):
                raise RuntimeError(f'Mio HTTP {exc.code}') from None
        return result.get('data', result)

    def capabilities(self):
        return self.request('/api/v1/capabilities')

    def generate(self, provider_id, prompt, api_key=''):
        body = {'providerId': provider_id, 'prompt': prompt}
        if api_key:
            body['apiKey'] = api_key
        return self.request('/api/v1/images/generations', body)

    def save_asset(self, endpoint, output):
        data_url = self.request(endpoint)['dataUrl']
        header, encoded = data_url.split(',', 1)
        if ';base64' not in header:
            raise ValueError('Expected base64 image')
        path = Path(output)
        # Do not silently overwrite an existing illustration.
        with path.open('xb') as handle:
            handle.write(base64.b64decode(encoded, validate=True))
        return path


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default=os.environ.get('MIO_URL', 'http://127.0.0.1:8777'))
    parser.add_argument('--provider-id')
    parser.add_argument('--prompt')
    parser.add_argument('--output', default='mio-image.png')
    args = parser.parse_args()
    client = MioClient(args.base_url)
    if args.prompt:
        if not args.provider_id:
            parser.error('--provider-id is required for paid generation')
        if Path(args.output).exists():
            parser.error('Output exists; choose another filename before generating')
        result = client.generate(args.provider_id, args.prompt, os.environ.get('MIO_PROVIDER_KEY', ''))
        print(client.save_asset(result['assetEndpoint'], args.output))
    else:
        print(json.dumps(client.capabilities(), indent=2, ensure_ascii=False))
