import json, re

with open('stream_generate_resp.txt', 'r', encoding='utf-8') as f:
    raw = f.read()

# 寻找所有 [["wrb.fr", ...]] 的匹配项
pattern = re.compile(r'\[\["wrb\.fr",.*?\]\](?=\n\d+|\n?$)', re.DOTALL)
matches = pattern.findall(raw)
print(f"Regex found {len(matches)} wrb.fr blocks")

if not matches:
    # 尝试另一种分割方式
    blocks = re.split(r'\n\d+\n', raw)
    print(f"Split by length header found {len(blocks)} blocks")
    matches = [b for b in blocks if 'wrb.fr' in b]

for i, block in enumerate(matches):
    block = block.strip()
    try:
        arr = json.loads(block)
        print(f"=== Block {i} (len={len(block)}) ===")
        for item in arr:
            if isinstance(item, list) and len(item) > 2 and item[2]:
                inner_str = item[2]
                try:
                    inner = json.loads(inner_str)
                    print(f"  Inner parsed ok. Top keys/type: {type(inner)}")
                    
                    # 遍历查找文本与状态
                    def walk(val, path=""):
                        if isinstance(val, dict):
                            for k, v in val.items():
                                walk(v, f"{path}.{k}" if path else str(k))
                        elif isinstance(val, list):
                            for idx, v in enumerate(val):
                                walk(v, f"{path}[{idx}]")
                        elif isinstance(val, str):
                            if any(k in val for k in ["<konatan", "guideline", "policy", "help with", "filter", "Master", "林凡"]):
                                print(f"    [STR] {path}: {repr(val[:150])}")
                        elif isinstance(val, (int, bool)):
                            if any(k in path.lower() for k in ["finish", "safety", "block", "status", "filter", "harm", "reason", "error"]):
                                print(f"    [VAL] {path}: {val}")

                    walk(inner)
                except Exception as ex:
                    print(f"  Inner JSON parse failed: {ex}")
    except Exception as e:
        print(f"Block {i} json parse error: {e}")
