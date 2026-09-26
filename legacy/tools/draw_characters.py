import urllib.request
import urllib.error
import json
import re
import os
import time

OUTPUT_DIR = os.path.abspath('generated_images/characters')
os.makedirs(OUTPUT_DIR, exist_ok=True)

prompts = {
    'female_lead': (
        "动漫角色立绘与半身肖像。女主角苏同：外貌约十一二岁的可爱灵动小女孩，乌黑柔顺、泛着自然光泽的长发用一根浅红色发绳扎成微翘的侧马尾，垂在单侧肩头。"
        "有一双又圆又大、极为清澈明亮的杏眼，长睫毛，眼神生动灵气；鼻梁精致秀挺，樱花浅粉色薄唇微抿，皮肤吹弹可破白皙细腻。"
        "身穿微显宽大的复古纯白短袖棉衫，浅蓝牛仔裤。纯净温暖的自然光照，单色微光柔和背景，精美细腻线描结合手绘水彩质感，新海诚式高光与空气感，吉卜力式纯真美感，高清杰作。"
    ),
    'male_lead': (
        "动漫角色立绘与半身肖像。男主角少年苏同：约十三四岁的初中男生，身形瘦弱微驼，留着很长时间没剪、遮住额头眉眼的蓬松黑碎发刘海，鼻梁上架着一副略显土气的黑色全框近视眼镜，双眸清澈但眼神略带未经世事的局促与自卑。"
        "身穿九十年代末洗得微褪色的黑白拼色宽松老式运动校服，怀里抱着几本泛黄的厚课本。柔和温润的自然漫射光，浅灰色干净背景，精细线描，写实怀旧动漫插画风格，青春电影质感，高清杰作。"
    )
}

API_URL = 'http://127.0.0.1:5104/v1/chat/completions'
MODEL_NAME = 'gpt-image-2.5-flare'

for key, prompt_text in prompts.items():
    dest = os.path.join(OUTPUT_DIR, f"{key}.png")
    print(f"\n==========================================")
    print(f"正在绘制角色参考图: {key}")
    print(f"==========================================")
    
    success = False
    for attempt in range(5):
        try:
            print(f"-> 正在向 5104 端口请求 gpt-image-2.5-flare (第 {attempt+1}/5 次尝试)...")
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
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                content = data['choices'][0]['message']['content']
                urls = re.findall(r'!\[.*?\]\((https?://[^\)]+)\)', content)
                if not urls:
                    urls = re.findall(r'https?://[^\s\)\"\'\<\>]+', content)
                
                if urls:
                    img_url = urls[0]
                    print(f"-> 获取图像链接成功，正在下载...")
                    urllib.request.urlretrieve(img_url, dest)
                    print(f"✓ {key} 绘制完成并保存成功: {dest} ({os.path.getsize(dest):,} 字节)")
                    success = True
                    break
                else:
                    print(f"-> 未在回复中检测到链接，文本内容: {content[:100]}")
        except urllib.error.HTTPError as e:
            err = e.read().decode('utf-8', errors='ignore')
            print(f"-> HTTP 错误 {e.code}: {err[:150]}")
            wait_time = 18 if e.code in (429, 502) else 8
            print(f"-> 冷却 {wait_time} 秒后重试...")
            time.sleep(wait_time)
        except Exception as e:
            print(f"-> 请求异常: {e}")
            time.sleep(10)
            
    if not success:
        print(f"✗ {key} 绘制失败")
    else:
        print("-> 成功绘制，冷却 15 秒后绘制下一个角色...")
        time.sleep(15)

print("\n\n所有角色绘制任务完成！")
