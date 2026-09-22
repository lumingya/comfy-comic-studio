import json, re

with open('stream_generate_resp.txt', 'r', encoding='utf-8') as f:
    raw = f.read()

pattern = re.compile(r'\[\["wrb\.fr",.*?\]\](?=\n\d+|\n?$)', re.DOTALL)
matches = pattern.findall(raw)

for idx in [4, 5, 6]:
    arr = json.loads(matches[idx].strip())
    inner = json.loads(arr[0][2])
    print(f"================ Block {idx} ================")
    print(json.dumps(inner, ensure_ascii=False, indent=2))
