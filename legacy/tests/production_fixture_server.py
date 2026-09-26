"""Controlled acceptance host. Never use as a real provider: all images are test fixtures."""
import base64
import json
import os
from pathlib import Path
import sys
import threading
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import server
from backend.mio_library import atomic_write
LOCK=threading.Lock();calls=[]
PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfX8AAAAASUVORK5CYII='
def generate(payload):
    if payload.get('config',{}).get('baseUrl')!='https://controlled.invalid/v1':raise ValueError('Acceptance host blocks every non-fixture provider')
    with LOCK:
        calls.append({'prompt':payload['prompt'],'negative':payload.get('negative'),'frame':payload.get('frame')})
        atomic_write(Path(server.DATA_DIR)/'controlled-calls.json',json.dumps(calls).encode())
    time.sleep(.09)
    return {'image':server.native_store().upload('data:image/png;base64,'+PNG)}
server.generate_provider_image=generate
if __name__=='__main__':server.main()
