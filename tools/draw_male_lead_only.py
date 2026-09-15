import urllib.request
import urllib.error
import json
import re
import os
import hashlib
import shutil

API_URL = 'http://127.0.0.1:5104/v1/chat/completions'
MODEL_NAME = 'gpt-image-2.5-sunburst'
OUTPUT_DIR = os.path.abspath('generated_images/characters')
os.makedirs(OUTPUT_DIR, exist_ok=True)

dest = os.path.join(OUTPUT_DIR, "male_lead.png")
prompt = "画一个美少年的绝美立绘图，校服，构图精美有创意"

print(f"-> 正在请求 gpt-image-2.5-sunburst 绘制男主: \"{prompt}\"...")
payload = {
    'model': MODEL_NAME,
    'messages': [{'role': 'user', 'content': prompt}],
    'stream': False
}

req = urllib.request.Request(
    API_URL,
    data=json.dumps(payload).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)

try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        content = res['choices'][0]['message']['content']
        urls = re.findall(r'!\[.*?\]\((https?://[^\)]+)\)', content)
        if not urls:
            urls = re.findall(r'https?://[^\s\)\"\'\<\>]+', content)
        if not urls:
            raise ValueError(f"未找到图像链接: {content[:200]}")
        
        img_url = urls[0]
        print(f"-> 获取 URL 成功，下载到 {dest}...")
        urllib.request.urlretrieve(img_url, dest)
        size = os.path.getsize(dest)
        print(f"✓ 男主角立绘绘制并下载成功! 大小: {size:,} 字节")

        # 自动计算 hash 并部署资产
        with open(dest, 'rb') as f:
            h = hashlib.sha256(f.read()).hexdigest()
        print(f"-> SHA-256: {h}")

        for target_dir in [
            'data/runtime/staging/images',
            'data/plans/你好，另一个我--o_another_me.assets/images',
            'data/presets/characters/你好，另一个我 · 角色设定--o_another_me.assets/images',
            'data/records/characters/你好，另一个我--_hello_another_me.assets/images',
        ]:
            os.makedirs(target_dir, exist_ok=True)
            shutil.copyfile(dest, os.path.join(target_dir, f"{h}.png"))
            shutil.copyfile(dest, os.path.join(target_dir, "male_lead.png"))
        print("✓ 已自动部署至系统图片资产库。")
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}:", e.read().decode('utf-8', errors='ignore'))
except Exception as e:
    print("Exception:", e)
