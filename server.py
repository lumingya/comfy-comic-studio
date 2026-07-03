import os
import json
import uuid
import urllib.request
from http.server import SimpleHTTPRequestHandler, HTTPServer

PORT = 8777
DATA_FILE = os.path.join(os.path.dirname(__file__), "comfy_comic_data.json")
IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")
os.makedirs(IMAGES_DIR, exist_ok=True)

class ComicRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS for local file:/// protocol fallback access
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Disable caching completely for development & instant updates
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/config':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            if os.path.exists(DATA_FILE):
                try:
                    with open(DATA_FILE, 'r', encoding='utf-8') as f:
                        self.wfile.write(f.read().encode('utf-8'))
                except Exception as e:
                    self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
            else:
                self.wfile.write(json.dumps({}).encode('utf-8'))
        else:
            # Server static files
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/config':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                
                # Validate JSON format
                data = json.loads(post_data.decode('utf-8'))
                with open(DATA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

        elif self.path == '/api/save-image':
            # Download a ComfyUI image URL and persist it locally under /images/
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data.decode('utf-8'))
                img_url = payload.get('url', '')
                if not img_url:
                    raise ValueError('Missing url field')

                # Determine file extension from URL or default to .png
                ext = '.png'
                for candidate in ['.jpg', '.jpeg', '.webp', '.png']:
                    if candidate in img_url.lower():
                        ext = candidate
                        break

                filename = f"comfy_{uuid.uuid4().hex[:12]}{ext}"
                dest_path = os.path.join(IMAGES_DIR, filename)

                req = urllib.request.Request(img_url, headers={'User-Agent': 'ComfyComicStudio/1.0'})
                with urllib.request.urlopen(req, timeout=30) as resp, open(dest_path, 'wb') as out:
                    out.write(resp.read())

                local_url = f"http://127.0.0.1:{PORT}/images/{filename}"
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "localUrl": local_url}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    # Change working dir to server.py directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"=========================================================")
    print(f" ComfyComic Studio 本地服务已成功启动！")
    print(f" 网页访问地址: http://127.0.0.1:{PORT}/index.html")
    print(f" 物理落盘配置文件: comfy_comic_data.json")
    print(f"=========================================================")
    server = HTTPServer(('127.0.0.1', PORT), ComicRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
