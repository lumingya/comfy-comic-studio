import urllib.request
import urllib.error
import json
import re
import os

dest = os.path.abspath('generated_images/characters/female_lead.png')
os.makedirs(os.path.dirname(dest), exist_ok=True)

# 顶级二次元美少女设定：京阿尼/新海诚初恋天花板、绝美五官、琉璃光泽黑发侧马尾、复古白衬衫
prompt = (
    "Masterpiece anime character sheet and portrait of an exceptionally beautiful anime bishoujo (绝美美少女, peak anime heroine) named Su Tong. "
    "A stunning high school girl with captivating, radiant crystal eyes featuring brilliant starlight highlights, long eyelashes, delicate features, soft natural blush, gentle enchanting smile. "
    "Silky lustrous raven-black hair styled into a charming side ponytail tied with a graceful red ribbon, resting on her shoulder with delicate fluttering bangs. "
    "Wearing a loose retro white short-sleeved cotton shirt, casual light blue denim pants, clean white sneakers. "
    "Kyoto Animation and Makoto Shinkai movie visual aesthetic, soft warm cinematic lighting, sunbeams, gentle rim light, crisp delicate linework, pastel watercolor shading, ultra high resolution, best quality anime illustration."
)

API_URL = 'http://127.0.0.1:5104/v1/chat/completions'
MODEL_NAME = 'gpt-image-2.5-flare'

print("-> 正在向 5104 请求绝美版美少女 female_lead 立绘...")
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
        res_text = resp.read().decode('utf-8')
        data = json.loads(res_text)
        content = data['choices'][0]['message']['content']
        urls = re.findall(r'!\[.*?\]\((https?://[^\)]+)\)', content)
        if not urls:
            urls = re.findall(r'https?://[^\s\)\"\'\<\>]+', content)
        if urls:
            img_url = urls[0]
            print(f"-> 获取图像成功，URL 长度: {len(img_url)}，开始下载...")
            urllib.request.urlretrieve(img_url, dest)
            print(f"SUCCESS! Saved to {dest} ({os.path.getsize(dest):,} bytes)")
        else:
            print("No URL in content:", content)
except urllib.error.HTTPError as e:
    print(f"HTTPError {e.code}:", e.read().decode('utf-8', errors='ignore'))
except Exception as e:
    print("Exception:", e)
