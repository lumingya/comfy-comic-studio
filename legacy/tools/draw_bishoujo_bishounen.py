import urllib.request
import json
import re
import os
import subprocess

API_URL = 'http://127.0.0.1:5104/v1/chat/completions'
MODEL_NAME = 'gpt-image-2.5-flare'
OUTPUT_DIR = os.path.abspath('generated_images/characters')
os.makedirs(OUTPUT_DIR, exist_ok=True)

prompts = {
    'female_lead': (
        "画一个美少女的绝美立绘图，校服，构图精美有创意。"
        "极致二次元神颜，精致细腻的五官，光泽灵动的大眼睛与根根分明的长睫毛，微风吹拂的柔顺黑发侧马尾，青春校园制服与红色领结。"
        "充满空气感的唯美光影，大师级插画构图与电影级镜头感，杰作，超高清 8k 原画"
    ),
    'male_lead': (
        "画一个美少年的绝美立绘图，校服，构图精美有创意。"
        "二次元校草级美少年神颜，清秀俊逸的面容，清澈深邃的星眸，帅气蓬松的黑色短碎发刘海，青春学院风校服衬衫与领带。"
        "充满故事感与青春浪漫气息的唯美光影，大师级插画构图，动人意境，杰作，超高清 8k 原画"
    )
}

def generate_and_download(key, prompt_text):
    dest = os.path.join(OUTPUT_DIR, f"{key}.png")
    print(f"\n==========================================")
    print(f"正在绘制 {key}: {prompt_text[:30]}...")
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

print("\n男女主角全部生成完毕！")
