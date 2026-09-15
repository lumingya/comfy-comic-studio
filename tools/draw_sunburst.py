import urllib.request
import json
import re
import os
import subprocess

API_URL = 'http://127.0.0.1:5104/v1/chat/completions'
MODEL_NAME = 'gpt-image-2.5-sunburst'
OUTPUT_DIR = os.path.abspath('generated_images/characters')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 严格按用户原话逐字使用，模型切换为 gpt-image-2.5-sunburst
prompts = {
    'female_lead': '画一个美少女的绝美立绘图，校服，构图精美有创意',
    'male_lead': '画一个美少年的绝美立绘图，校服，构图精美有创意'
}

def generate_and_download(key, prompt_text):
    dest = os.path.join(OUTPUT_DIR, f"{key}.png")
    print(f"\n==========================================")
    print(f"正在以 gpt-image-2.5-sunburst 绘制 {key}: \"{prompt_text}\"")
    print(f"==========================================")
    
    payload = {
        'model': MODEL_NAME,
        'messages': [{'role': 'user', 'content': prompt_text}],
        'stream': False
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json'}
    )
    
    with urllib.request.urlopen(req, timeout=120) as resp:
        res = json.loads(resp.read().decode('utf-8'))
        content = res['choices'][0]['message']['content']
        urls = re.findall(r'!\[.*?\]\((https?://[^\)]+)\)', content)
        if not urls:
            urls = re.findall(r'https?://[^\s\)\"\'\<\>]+', content)
        if not urls:
            raise ValueError(f"No image URL found in response: {content[:200]}")
        
        img_url = urls[0]
        print(f"-> 获取 URL 成功，调用 curl 下载...")
        curl_res = subprocess.run(['curl', '-s', '-L', img_url, '-o', dest])
        if curl_res.returncode != 0 or not os.path.exists(dest) or os.path.getsize(dest) < 10000:
            raise RuntimeError(f"Download failed with returncode {curl_res.returncode}, size: {os.path.getsize(dest) if os.path.exists(dest) else 0}")
        print(f"✓ {key} 绘制并下载成功! 大小: {os.path.getsize(dest):,} 字节")

for k, p in prompts.items():
    generate_and_download(k, p)

print("\nSunburst 模型男女主角原话生图全部完成！")
