"""Real protocol-shaped local fixtures. All non-loopback networking is blocked."""
import base64
import io
import json
import os
from pathlib import Path
import socket
import sys
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import server
from backend.mio_library import atomic_write

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfX8AAAAASUVORK5CYII=')
wire = []
lock = threading.Lock()
original_connect = socket.socket.connect
original_resolve = socket.getaddrinfo

def connect(sock, address):
    if isinstance(address, tuple) and address[0] not in ('127.0.0.1', '::1', 'localhost'):
        raise OSError('Journey fixture blocks non-loopback networking')
    return original_connect(sock, address)

def resolve(host, *args, **kwargs):
    if host not in ('127.0.0.1', '::1', 'localhost', None):
        raise OSError('Journey fixture blocks external DNS')
    return original_resolve(host, *args, **kwargs)

socket.socket.connect = connect
socket.getaddrinfo = resolve

class Provider(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def reply(self, value, status=200, mime='application/json'):
        raw = value if isinstance(value, bytes) else json.dumps(value).encode()
        self.send_response(status); self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def record(self, body=None):
        with lock:
            wire.append({'method': self.command, 'path': self.path, 'body': body,
                         'hasAuth': bool(self.headers.get('Authorization')),
                         'keyTag': {'Bearer fixture-A':'A','Bearer fixture-B':'B','Bearer fixture-fail':'fail'}.get(self.headers.get('Authorization'), 'other' if self.headers.get('Authorization') else '')})
            atomic_write(Path(server.DATA_DIR) / 'journey-wire.json', json.dumps(wire).encode())
    def do_GET(self):
        self.record()
        if self.path == '/system_stats': return self.reply({'system': {'comfyui_version': 'fixture'}, 'devices': []})
        if self.path in ('/v1/models','/pool/v1/models'): return self.reply({'data': [{'id': 'fixture-image'}, {'id': 'fixture-chat'}]})
        if self.path.startswith('/history/'):
            return self.reply({'journey-prompt': {'status': {'completed': True, 'status_str': 'success'}, 'outputs': {'9': {'images': [{'filename': 'fixture.png', 'subfolder': '', 'type': 'output'}]}}}})
        if self.path.startswith('/view?'): return self.reply(PNG, mime='image/png')
        self.reply({'error': 'This fixture has no model discovery at this path'}, 404)
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0')))); self.record(body)
        if self.path == '/prompt':
            assert body['prompt']['6']['inputs']['text'].strip()
            return self.reply({'prompt_id': 'journey-prompt'})
        if self.path.startswith('/pool/') and self.command=='POST':
            if self.headers.get('Authorization')=='Bearer fixture-fail':return self.reply({'error':'rejected'},401)
            if self.path.endswith('/ai/generate-image'):
                data=io.BytesIO()
                with zipfile.ZipFile(data,'w') as archive:archive.writestr('image.png',PNG)
                return self.reply(data.getvalue(),mime='application/zip')
            return self.reply({'data':[{'b64_json':base64.b64encode(PNG).decode()}]})
        if self.path == '/ai/generate-image':
            if self.headers.get('Authorization') != 'Bearer fixture-valid':
                return self.reply({'error': 'fixture credential rejected'}, 401)
            data = io.BytesIO()
            with zipfile.ZipFile(data, 'w') as archive: archive.writestr('image.png', PNG)
            return self.reply(data.getvalue(), mime='application/zip')
        if self.path == '/v1/images/generations':
            assert body['model'] == 'fixture-image'
            assert not self.headers.get('Authorization')
            return self.reply({'data': [{'b64_json': base64.b64encode(PNG).decode()}]})
        if self.path == '/manual/v1/chat/completions':
            assert body['model'] == 'fixture-chat'
            assert 'size' not in body and 'quality' not in body
            return self.reply({'choices': [{'message': {'content': [{'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(PNG).decode()}}]}}]})
        self.reply({'error': 'Unknown controlled endpoint'}, 400)

if __name__ == '__main__':
    upstream = ThreadingHTTPServer(('127.0.0.1', int(os.environ['MIO_JOURNEY_PROVIDER_PORT'])), Provider)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    try: server.main()
    finally: upstream.shutdown(); upstream.server_close()
