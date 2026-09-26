import json
import urllib.request
import urllib.error
import re
import os
import time

OUTPUT_DIR = os.path.abspath('generated_images/hello_another_me')
os.makedirs(OUTPUT_DIR, exist_ok=True)

STORY_FILE = 'examples/storyboards/你好另一个我_分镜导入.json'
with open(STORY_FILE, encoding='utf-8') as f:
    doc = json.load(f)

variables = {
    'female_name': '苏同',
    'female_lead': '乌黑柔顺的长发扎成微翘的侧马尾，浅红发绳，又大又圆的清澈大杏眼，吹弹可破的白皙细腻肌肤，樱花浅粉色薄唇，身穿微显宽大的复古纯白短袖棉衫与浅蓝洗水牛仔七分裤，身形纤细轻盈的灵动小女孩',
    'male_name': '少年苏同',
    'male_lead': '留着遮住额头眉眼的厚碎发刘海，鼻梁架着土气的黑色全框近视眼镜，身穿九十年代末洗得微旧的黑白拼色宽松运动校服，身材瘦弱微驼、神态青涩自卑怀抱课本的初中男生',
    'style': '高完成度叙事漫画，电影级青春光影，新海诚式清透夏日自然光与细腻手绘水彩质感，温润怀旧自然色调'
}

def resolve_prompt(p):
    for k, v in variables.items():
        p = p.replace('{' + k + '}', v)
    return p

API_URL = 'http://127.0.0.1:5104/v1/chat/completions'
MODEL_NAME = 'gpt-image-2.5-flare'

for idx, frame in enumerate(doc['frames']):
    name = frame['name']
    prompt = resolve_prompt(frame['prompt'])
    safe_name = f"frame_{idx+1:02d}_{name.split('：')[-1]}"
    target_path = os.path.join(OUTPUT_DIR, f"{safe_name}.png")
    
    print(f"\n==========================================")
    print(f"[{idx+1}/{len(doc['frames'])}] 处理分镜: {name}")
    print(f"==========================================")
    
    if os.path.exists(target_path) and os.path.getsize(target_path) > 100000:
        print(f"✓ 该帧图片已存在，自动跳过: {os.path.basename(target_path)} ({os.path.getsize(target_path):,} bytes)")
        continue
    
    success = False
    for attempt in range(5):
        try:
            print(f"-> 正在向 5104 发送请求 (第 {attempt+1}/5 次尝试)...")
            payload = {
                'model': MODEL_NAME,
                'messages': [
                    {'role': 'user', 'content': prompt}
                ],
                'stream': False
            }
            req = urllib.request.Request(
                API_URL,
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                content = data['choices'][0]['message']['content']
                urls = re.findall(r'!\[.*?\]\((https?://[^\)]+)\)', content)
                if not urls:
                    urls = re.findall(r'https?://[^\s\)\"\'\<\>]+', content)
                
                if urls:
                    img_url = urls[0]
                    print(f"-> 获取图片下载链接成功，正在下载...")
                    urllib.request.urlretrieve(img_url, target_path)
                    print(f"✓ 帧 {idx+1} 保存成功: {target_path} ({os.path.getsize(target_path):,} bytes)")
                    success = True
                    break
                else:
                    print(f"-> 未在回复中检测到图片链接，回复预览: {content[:120]}")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8', errors='ignore')
            print(f"-> HTTP 错误 {e.code}: {err_body[:200]}")
            wait_sec = 15 if e.code in (429, 502) else 5
            print(f"-> 等待 {wait_sec} 秒后重试...")
            time.sleep(wait_sec)
        except Exception as e:
            print(f"-> 网络/系统异常: {e}")
            time.sleep(8)
    
    if not success:
        print(f"✗ 帧 {idx+1} 生成重试用尽，跳过该帧")
    else:
        # 生成成功后冷却 10 秒，保护 arena 并发池
        print("-> 冷却 10 秒后绘制下一帧...")
        time.sleep(10)

print("\n\n==========================================")
print("所有分镜生成任务结束！")
print(f"目标目录: {OUTPUT_DIR}")
print("==========================================")
