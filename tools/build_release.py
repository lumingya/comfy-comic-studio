#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ComfyComic Studio - Windows Release Packaging Script
Version: 0.0.1
===================================================
此脚本完全独立生成纯净的 v9 原生初始配置（1 个画册集、1 本画册、1 张图片、1 个十二幕模板、1 组七海标准设定），
严格区分 character（生图提示词）与 character_display_name（字幕显示名），
彻底隔离本地历史测试数据与 R18 历史分镜，自动编译免 Python 独立可执行程序并打包为绿色压缩包。
"""

import os
import sys
import shutil
import json
import zipfile
import subprocess
import time

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = "0.0.1"
RELEASE_NAME = f"comfy-comic-studio-v{VERSION}-windows"
DIST_DIR = os.path.join(ROOT_DIR, "dist")
RELEASE_DIR = os.path.join(DIST_DIR, RELEASE_NAME)
ZIP_FILE = os.path.join(DIST_DIR, f"{RELEASE_NAME}.zip")
BUILD_TEMP_DIR = os.path.join(ROOT_DIR, "build", "pyinstaller")

def get_v9_pure_default_data():
    """
    构造与 v9 createCuratedDemo 严格 1:1 对齐的纯净原生默认数据。
    包含：
    1. 画册集：夏日叙事集 (collection_summer)
    2. 画册：海风与未寄出的信 (edition_letter, 1 幕已生成封面)
    3. 分镜模板：远行与归来 · 十二幕 (story_journey12)
    4. 变量设定：七海 · 标准角色设定 (setting_nanami)
       - character: "nanami" (Prompt 绘图提示词)
       - character_display_name: "七海" (字幕与角色显示名)
    5. 创作计划：海风与未寄出的信 (draft_letter)
    """
    now = int(time.time() * 1000)
    collection_id = "collection_summer"
    template_id = "story_journey12"
    row_id = "character_nanami"
    set_id = "setting_nanami"
    plan_id = "draft_letter"

    names = [
        "风起的日常", "未署名的来信", "决定出发", "通往海岸的小路",
        "第一个线索", "旅途中的同行者", "走错的方向", "风雨将至",
        "独自做出的选择", "灯光下的答案", "终于重逢", "风抵达的地方"
    ]
    lines = [
        "夏日的风经过窗边，故事还没有名字。",
        "{character_display_name}收到一封没有署名的信，信纸上留着海的气息。",
        "有些答案，需要亲自走到远方。",
        "小路穿过山野，通向记忆里的海岸。",
        "旧车站的钟，停在我们约定的时刻。",
        "她遇见一位旅人，也听见了一段熟悉的往事。",
        "错过的岔路，原来也有自己的风景。",
        "云层渐渐聚拢，风替她收起了迟疑。",
        "这一次，{character_display_name}决定不再等待。",
        "远处的灯光亮起，信里的一切终于有了答案。",
        "那个熟悉的身影，仍站在夏日的光里。",
        "我们把重逢写进风里，下一段故事从这里开始。"
    ]
    shots = [
        "a quiet seaside town, distant train tracks, calm summer morning",
        "holding an old letter, close portrait, delicate eyes",
        "standing at an open station gate, a journey begins",
        "cinematic wide landscape, mountain path above the sea",
        "an abandoned train platform, warm faded signs",
        "two travelers meeting by a harbor, soft light",
        "a fork in a green mountain path, reflective atmosphere",
        "wind rises over the coast, dramatic soft clouds",
        "determined expression, wind in hair, dramatic composition",
        "warm lantern at a seaside station, dusk",
        "a quiet reunion, silhouette in warm sunset",
        "ocean horizon, gentle wind, hopeful ending"
    ]

    frames = []
    for i in range(12):
        frames.append({
            "id": f"letter_frame_{i}",
            "stepIndex": i,
            "name": names[i],
            "camera": "Wide",
            "prompt": f"{{character}}, {{outfit}}, {{style}}, {{scene}}, {{weapon}}, {shots[i]}",
            "caption": lines[i],
            "negative": "",
            "width": 768,
            "height": 1024,
            "steps": 24,
            "cfg": 7,
            "denoise": 1,
            "seed": -1,
            "status": "pending",
            "renderOverride": False,
            "nodeOverrides": {}
        })

    row = {
        "id": row_id,
        "projectId": collection_id,
        "active": False,
        "bookTitle": "海风与未寄出的信",
        "character": "nanami",
        "character_display_name": "七海",
        "outfit": "white shirt, navy skirt, small canvas bag",
        "style": "cinematic anime illustration, delicate cel shading, soft film texture",
        "scene": "a quiet coastal town in summer",
        "weapon": "",
        "lora": "",
        "references": {},
        "storyVersions": {},
        "activeStoryVersionIds": {},
        "_planMapped": True
    }

    variable_entries = [
        {"id": "var_char", "key": "character", "type": "text", "value": row["character"]},
        {"id": "var_disp", "key": "character_display_name", "type": "text", "value": row["character_display_name"]},
        {"id": "var_outfit", "key": "outfit", "type": "text", "value": row["outfit"]},
        {"id": "var_style", "key": "style", "type": "text", "value": row["style"]},
        {"id": "var_scene", "key": "scene", "type": "text", "value": row["scene"]},
        {"id": "var_weapon", "key": "weapon", "type": "text", "value": row["weapon"]},
        {"id": "var_lora", "key": "lora", "type": "text", "value": row["lora"]}
    ]

    project = {
        "id": collection_id,
        "title": "夏日叙事集",
        "createdAt": now
    }

    template = {
        "id": template_id,
        "projectId": collection_id,
        "title": "远行与归来 · 十二幕",
        "characterIdentityVersion": 1,
        "outline": "一封信、一段旅途，与一次迟来的重逢。十二幕通用故事骨架，可改写为冒险、日常或幻想。",
        "frames": frames,
        "createdAt": now
    }

    demo_step = {
        "stepIndex": 0,
        "name": frames[0]["name"],
        "prompt": "nanami, white shirt, navy skirt, small canvas bag, cinematic anime illustration, delicate cel shading, soft film texture, a quiet coastal town in summer, a quiet seaside town, distant train tracks, calm summer morning",
        "caption": "夏日的风经过窗边，故事还没有名字。",
        "image": "https://images.alphacoders.com/819/thumbbig-819506.webp"
    }

    book = {
        "id": "edition_letter",
        "projectId": collection_id,
        "title": row["bookTitle"],
        "characterName": row["character_display_name"],
        "rowId": row_id,
        "templateId": template_id,
        "templateTitle": template["title"],
        "synopsis": "那些没说出口的话，都藏在夏日的海风里。一封未寄出的信，带她走向久别后的重逢。",
        "tags": ["典藏示范", "青春", "治愈"],
        "totalSteps": 1,
        "generatedSteps": 1,
        "status": "complete",
        "inProgress": False,
        "liked": False,
        "likes": 0,
        "createdAt": now,
        "updatedAt": now,
        "completedAt": now,
        "theme": 0,
        "steps": [demo_step],
        "curatedDemo": True,
        "demoContentRevision": 2
    }

    variable_set = {
        "id": set_id,
        "projectId": collection_id,
        "title": "七海 · 标准角色设定",
        "entries": variable_entries
    }

    plan = {
        "id": plan_id,
        "projectId": collection_id,
        "title": row["bookTitle"],
        "templateId": template_id,
        "rowId": row_id,
        "enabled": False,
        "variableSetIds": [set_id],
        "variables": [],
        "sceneOverrides": {},
        "createdAt": now,
        "updatedAt": now
    }

    creation = {
        "version": 1,
        "migratedAt": now,
        "variableSets": [variable_set],
        "plans": [plan]
    }

    content_data = {
        "templates": [template],
        "activeTemplateId": template_id,
        "batchMatrix": {
            "columns": ["character", "character_display_name", "outfit", "style", "scene", "weapon", "lora"],
            "rows": [row]
        },
        "savedGalleries": [book]
    }

    ui_data = {
        "uiConfig": {
            "theme": "dark",
            "activeProjectId": collection_id,
            "templateId": template_id,
            "storyTemplateId": template_id,
            "storyRowId": row_id,
            "creation": creation,
            "comfyStudio": {
                "projects": [project],
                "activeProjectId": collection_id,
                "workspaceId": "workspace_release",
                "creation": creation,
                "exportTemplates": [],
                "customColumns": ["scene", "weapon"],
                "installedPackages": [],
                "drafts": {},
                "settings": {
                    "comfy": {
                        "mode": "mock",
                        "workflow": {
                            "6": {
                                "class_type": "CLIPTextEncode",
                                "inputs": {
                                    "text": "{character}, anime illustration"
                                }
                            }
                        },
                        "mapping": {
                            "positive": "6"
                        },
                        "presets": []
                    },
                    "llm": {"mode": "mock", "key": "", "baseUrl": ""},
                    "xml": {"key": ""},
                    "critic": {"key": ""},
                    "studio": {
                        "visibility": {"logs": False},
                        "shell": {"collapsed": False},
                        "appearance": {"showMetrics": False}
                    },
                    "presentation": {
                        "version": 1,
                        "lab": {"refine": False, "mask": False},
                        "fonts": True,
                        "readerMode": "webtoon",
                        "defaultReaderMode": "webtoon"
                    }
                }
            }
        }
    }

    chat_data = {"sessions": [], "activeChatId": ""}
    comfy_data = {
        "comfyWorkflows": [],
        "comfyConfig": {
            "mode": "mock",
            "workflow": {
                "6": {
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "text": "{character}, anime illustration"
                    }
                }
            },
            "mapping": {"positive": "6"}
        },
        "nodePositive": "6",
        "nodeNegative": "",
        "nodeOutput": "9"
    }
    llm_data = {"llmConfig": {}}
    xml_data = {"xmlConfig": {}}

    return content_data, ui_data, chat_data, comfy_data, llm_data, xml_data

def create_start_bat(dst_path):
    content = """@echo off
chcp 65001 >nul
title ComfyComic Studio v0.0.1
echo =======================================================
echo   ComfyComic Studio v0.0.1 (Windows 发行版)
echo   本地服务与故事分镜工作台启动中...
echo =======================================================
echo.

cd /d "%~dp0"

:: 1. 优先使用随包编译的独立可执行文件（免装 Python 环境）
if exist "comfy-comic-studio.exe" (
    echo [启动模式] 使用独立可执行程序启动...
    "comfy-comic-studio.exe"
    goto end
)

:: 2. 回退使用系统 Python 运行 server.py
where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [启动模式] 使用系统 Python 启动...
    python server.py
    goto end
)

where py >nul 2>nul
if %errorlevel% equ 0 (
    echo [启动模式] 使用 Python Launcher (py) 启动...
    py server.py
    goto end
)

echo [错误] 未检测到 Python 运行时或 comfy-comic-studio.exe。
echo 请安装 Python 3.10+ (https://www.python.org/) 并勾选 "Add Python to PATH"。
echo.

:end
pause
"""
    with open(dst_path, "w", encoding="utf-8") as f:
        f.write(content.replace("\r\n", "\n").replace("\n", "\r\n"))

def create_readme(dst_path):
    content = f"""# 🎨 ComfyComic Studio v{VERSION} (Windows 便携发行版)

> **专为 AI 连环画 / 多格漫画 / 绘本创作者打造的本地批量生产工作台**  
> 支持角色名与字幕显示名独立设定、自由语法提示词与一键自动批量排版。100% 本地运行，隐私安全。

---

## 🚀 极速启动

### 方式一：独立程序启动（推荐，免装 Python）
直接双击根目录下的 **`comfy-comic-studio.exe`**。  
服务启动后将自动在系统默认浏览器中打开工作台。

### 方式二：脚本启动（有 Python 环境）
直接双击根目录下的 **`start.bat`**。

---

## 🌐 访问地址
浏览器访问：**http://127.0.0.1:8777/index.html**

## 💡 默认示范说明
- **原生预置**：1 个典藏画册集《夏日叙事集》、1 部示范画册《海风与未寄出的信》、1 套通用 12 幕分镜模板《远行与归来》。
- **角色名区分**：
  - `{{character}}`：英文绘图提示词专用（生图标签，如 `nanami` 或 `nahida`）；
  - `{{character_display_name}}`：字幕旁白与台词专用（如 `七海` 或 `纳西妲`）。
- **ComfyUI 连接**：默认连接 `127.0.0.1:8188`。若未开启 ComfyUI，可在工作流页面切换为「模拟模式」进行离线剧本排版与浏览。

---
*版本: v{VERSION} · 发布日期: 2026-09*
"""
    with open(dst_path, "w", encoding="utf-8") as f:
        f.write(content)

def build():
    print(f"============================================================")
    print(f"  [ComfyComic Studio] 开始打包 Windows 便携发行版 v{VERSION}")
    print(f"============================================================")

    # 1. Prepare clean directories
    try:
        subprocess.run(["taskkill", "/f", "/im", "comfy-comic-studio.exe"], capture_output=True)
        time.sleep(0.5)
    except Exception:
        pass

    if os.path.exists(RELEASE_DIR):
        print(f"\n[1/5] 清理旧发行目录: {RELEASE_DIR}")
        try:
            shutil.rmtree(RELEASE_DIR)
        except Exception:
            time.sleep(1)
            shutil.rmtree(RELEASE_DIR, ignore_errors=True)
    if os.path.exists(ZIP_FILE):
        try:
            os.remove(ZIP_FILE)
        except Exception:
            pass
    os.makedirs(RELEASE_DIR, exist_ok=True)

    # 2. PyInstaller Build
    print("\n[2/5] 使用 PyInstaller 编译免 Python 独立可执行程序...")
    pyinstaller_cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--console",
        "--name", "comfy-comic-studio",
        "--distpath", RELEASE_DIR,
        "--workpath", BUILD_TEMP_DIR,
        os.path.join(ROOT_DIR, "server.py")
    ]
    print(f"  执行: {' '.join(pyinstaller_cmd)}")
    result = subprocess.run(pyinstaller_cmd, cwd=ROOT_DIR)
    if result.returncode != 0:
        print("  [提示] PyInstaller 编译返回非 0，继续检查可执行文件是否存在...")
    
    exe_path = os.path.join(RELEASE_DIR, "comfy-comic-studio.exe")
    if os.path.exists(exe_path):
        print(f"  PyInstaller 编译成功: {exe_path} ({os.path.getsize(exe_path)/(1024*1024):.2f} MB)")
    else:
        print("  [注意] 未生成 exe 文件，用户仍可使用 start.bat + 系统 Python 启动。")

    # 3. Copy frontend assets
    print("\n[3/5] 同步前端核心产物与静态资源...")
    for f in ["index.html", "styles.css", "favicon.svg", "server.py", "LICENSE", "default_comic_template.json"]:
        src = os.path.join(ROOT_DIR, f)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(RELEASE_DIR, f))
            print(f"  已复制: {f}")

    # Copy vendor
    vendor_src = os.path.join(ROOT_DIR, "vendor")
    vendor_dst = os.path.join(RELEASE_DIR, "vendor")
    if os.path.exists(vendor_src):
        shutil.copytree(vendor_src, vendor_dst, ignore=shutil.ignore_patterns("*.bak*", "*.tmp*"))
        print("  已复制: vendor/")

    # Copy modular js
    js_src = os.path.join(ROOT_DIR, "js")
    js_dst = os.path.join(RELEASE_DIR, "js")
    os.makedirs(js_dst, exist_ok=True)
    for js_file in ["state.js", "sync.js", "engine.js", "creation.js", "ui.js", "app.js", "README.js"]:
        src = os.path.join(js_src, js_file)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(js_dst, js_file))
    print("  已复制: js/ (解耦核心领域模块)")

    # 4. Generate pure v9 default configs
    print("\n[4/5] 写入 v9 原生纯净初始配置 (1集 / 1册 / 1图 / 1模板 / 区分角色名)...")
    content_data, ui_data, chat_data, comfy_data, llm_data, xml_data = get_v9_pure_default_data()

    data_dst = os.path.join(RELEASE_DIR, "data")
    os.makedirs(data_dst, exist_ok=True)

    with open(os.path.join(data_dst, "content.json"), "w", encoding="utf-8") as f:
        json.dump(content_data, f, ensure_ascii=False, indent=2)
    with open(os.path.join(data_dst, "ui.json"), "w", encoding="utf-8") as f:
        json.dump(ui_data, f, ensure_ascii=False, indent=2)
    with open(os.path.join(data_dst, "chat.json"), "w", encoding="utf-8") as f:
        json.dump(chat_data, f, ensure_ascii=False, indent=2)
    with open(os.path.join(data_dst, "comfy.json"), "w", encoding="utf-8") as f:
        json.dump(comfy_data, f, ensure_ascii=False, indent=2)
    with open(os.path.join(data_dst, "llm.json"), "w", encoding="utf-8") as f:
        json.dump(llm_data, f, ensure_ascii=False, indent=2)
    with open(os.path.join(data_dst, "xml_template.json"), "w", encoding="utf-8") as f:
        json.dump(xml_data, f, ensure_ascii=False, indent=2)

    # Empty images folder with marker
    images_dst = os.path.join(RELEASE_DIR, "images")
    os.makedirs(images_dst, exist_ok=True)
    with open(os.path.join(images_dst, ".gitkeep"), "w", encoding="utf-8") as f:
        f.write("# Local generated images stored here\n")

    # Generate enhanced start.bat and README.md
    create_start_bat(os.path.join(RELEASE_DIR, "start.bat"))
    create_readme(os.path.join(RELEASE_DIR, "README.md"))
    print("  已生成纯净的 data/ 文件夹、images/ 存储目录、start.bat 与 README.md。")

    # 5. Security and Cleanliness Audit
    print("\n[5/5] 安全与内容纯净度审计...")
    flagged = []
    r18_keywords = ["恶堕", "调教", "淫纹", "所长法典", "tpl_novelai", "tpl_r18", "沉沦", "堕落的轨迹"]
    for r_dir, dirs, files in os.walk(RELEASE_DIR):
        for fname in files:
            fpath = os.path.join(r_dir, fname)
            relpath = os.path.relpath(fpath, RELEASE_DIR)
            if fname.endswith((".json", ".txt", ".md", ".html")):
                try:
                    content = open(fpath, encoding="utf-8", errors="ignore").read().lower()
                    for kw in r18_keywords:
                        if kw in content:
                            flagged.append((relpath, kw))
                except Exception:
                    pass
    if flagged:
        raise RuntimeError(f"发现未清洗的敏感内容: {flagged}，终止打包！")
    print("  [审计通过] 发行包内 0 处敏感残留，完全符合全年龄开源规范。")

    # 6. Create Zip Archive
    print(f"\n正在压缩为便携绿色发行包: {ZIP_FILE}...")
    with zipfile.ZipFile(ZIP_FILE, "w", zipfile.ZIP_DEFLATED) as zf:
        for r_dir, dirs, files in os.walk(RELEASE_DIR):
            for file in files:
                abs_path = os.path.join(r_dir, file)
                rel_path = os.path.relpath(abs_path, os.path.dirname(RELEASE_DIR))
                zf.write(abs_path, rel_path)

    zip_size_mb = os.path.getsize(ZIP_FILE) / (1024 * 1024)
    dir_size_mb = sum(os.path.getsize(os.path.join(r, f)) for r, d, files in os.walk(RELEASE_DIR) for f in files) / (1024 * 1024)

    print(f"\n============================================================")
    print(f"🎉 打包完成！")
    print(f"  便携解压目录: {RELEASE_DIR} ({dir_size_mb:.2f} MB)")
    print(f"  分发压缩包:   {ZIP_FILE} ({zip_size_mb:.2f} MB)")
    print(f"============================================================\n")

if __name__ == "__main__":
    build()
