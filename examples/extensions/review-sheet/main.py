"""An optional, read-only exporter using only the stable extension contract."""

import base64
import html
import io
import math

from PIL import Image

STYLE = """
:root { color-scheme: light; font-family: system-ui, sans-serif; color: #29372f; }
body { margin: 0; padding: 40px; background: #f6f7f3; }
main { max-width: 1100px; margin: auto; }
header { display: flex; align-items: baseline; gap: 24px; border-bottom: 1px solid #ccd3c8;
  padding-bottom: 20px; margin-bottom: 28px; }
h1 { margin: 0; font: 500 28px Georgia, serif; overflow-wrap: anywhere; }
header p { margin: 0 0 0 auto; white-space: nowrap; color: #596959; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
article { break-inside: avoid; min-width: 0; }
.picture { height: 260px; display: flex; align-items: center; justify-content: center;
  background: white; border: 1px solid #dce1d8; border-radius: 6px; padding: 8px; }
img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; }
h2 { margin: 12px 0 6px; font-size: 14px; font-weight: 600; }
.notes { border-bottom: 1px solid #ccd3c8; height: 36px; }
footer { margin-top: 32px; font-size: 12px; color: #596959; }
@media (max-width: 650px) { body { padding: 20px; } .grid { grid-template-columns: 1fr; }
  header { display: block; } header p { margin-top: 12px; } }
@media print { @page { size: A4; margin: 12mm; } body { padding: 0; background: white; }
  header { margin-bottom: 16px; } h1 { font-size: 20px; }
  .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5mm; }
  .picture { height: 48mm; border-radius: 0; padding: 2mm; }
  .notes { height: 10mm; } }
"""


def review_sheet(image, strip, fmt, *, preset_id, title, subtitle, quality):
    """Capture each existing panel box, preserving its saved framing and aspect ratio.

    Numbering follows visual canvas order (top, then left), not an internal dictionary order.
    Each PNG is bounded to 480 px; the core renderer supplies the existing composed strip.
    """
    cards = []
    boxes = sorted(strip.panel_boxes.items(), key=lambda item: (item[1][1], item[1][0]))
    for index, (panel_id, box) in enumerate(boxes, 1):
        left, top, right, bottom = box
        bounds = (
            max(0, math.floor(left)),
            max(0, math.floor(top)),
            min(image.width, math.ceil(right)),
            min(image.height, math.ceil(bottom)),
        )
        if bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
            # A manually positioned panel outside the canvas remains identifiable in the sheet.
            picture = "<span>画格位于画布外</span>"
        else:
            thumb = image.crop(bounds)
            thumb.thumbnail((480, 480), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            thumb.save(out, "PNG")
            encoded = base64.b64encode(out.getvalue()).decode("ascii")
            picture = f'<img src="data:image/png;base64,{encoded}" alt="第 {index} 格">'
        safe_id = html.escape(panel_id, quote=True)
        cards.append(
            f'<article data-panel-id="{safe_id}"><div class="picture">{picture}</div>'
            f'<h2>{index:02d}</h2><div class="notes" aria-label="第 {index} 格备注"></div>'
            '<div class="notes" aria-hidden="true"></div></article>'
        )
    safe_title = html.escape(title)
    empty = "<p>当前画布没有分格。</p>" if not cards else ""
    document = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
        "img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">"
        f"<title>{safe_title} · 审稿表</title><style>{STYLE}</style></head><body><main>"
        f"<header><h1>{safe_title}</h1><p>{len(cards)} 格 · 审稿表</p></header>"
        f'<div class="grid">{"".join(cards)}</div>{empty}'
        "<footer>按画布从上到下、从左到右编号。显示已保存取景；跨格文字可能不完整。"
        "可使用浏览器打印，或保存为 PDF。</footer></main></body></html>"
    )
    return document.encode("utf-8"), "text/html; charset=utf-8", "review-sheet.html"


def activate(mio):
    mio.contribute(
        "exporter", "review-sheet", review_sheet, title="审稿联系表", interface="strip"
    )
