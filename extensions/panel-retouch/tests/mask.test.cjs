const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeContext {
  constructor(canvas) { this.canvas = canvas; this.globalCompositeOperation = "source-over"; }
  drawImage(source) { if (source?.hasPaint !== undefined) this.canvas.hasPaint = source.hasPaint; }
  setTransform() {}
  fillRect() { this.canvas.hasPaint = this.globalCompositeOperation === "destination-out" ? false : true; }
  stroke() { this.canvas.hasPaint = this.globalCompositeOperation === "destination-out" ? false : true; }
  beginPath() {}
  moveTo() {}
  lineTo() {}
  save() { this.savedOperation = this.globalCompositeOperation; }
  restore() { if (this.savedOperation) this.globalCompositeOperation = this.savedOperation; }
  setLineDash() {}
  strokeRect() {}
  clearRect() { this.canvas.hasPaint = false; }
  getImageData() { return { data: new Uint8ClampedArray([255, 255, 255, this.canvas.hasPaint ? 255 : 0]) }; }
  putImageData(value) { this.canvas.pixels = Array.from(value.data); this.canvas.hasPaint = value.data[3] > 0; }
}
class FakeCanvas {
  constructor() { this.width = 10; this.height = 10; this.listeners = {}; this.hasPaint = false; this.context = new FakeContext(this); this.style = {}; }
  getContext() { return this.context; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  setPointerCapture() {}
  focus() {}
  toBlob(callback) { callback(new Blob([JSON.stringify(this.pixels || [])], { type: "image/png" })); }
}

async function main() {
  const created = [];
  const document = { createElement: (tag) => { assert.equal(tag, "canvas"); const canvas = new FakeCanvas(); created.push(canvas); return canvas; } };
  const window = { devicePixelRatio: 1 };
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../mask.js`, "utf8"), {
    window, document, ResizeObserver: class { observe() {} }, devicePixelRatio: 1,
    Uint8ClampedArray, Promise, Math, Number, Error, Blob
  });
  const image = { naturalWidth: 10, naturalHeight: 10, listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; } };
  const canvas = new FakeCanvas();
  const stage = { getBoundingClientRect: () => ({ width: 100 }) };
  const controls = { undo: { disabled: true }, redo: { disabled: true }, clear: { disabled: true } };
  const editor = new window.MioMaskEditor(image, canvas, stage, controls);
  const pointer = (type, x, y) => canvas.listeners[type]({ button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {} });
  pointer("pointerdown", 15, 15);
  pointer("pointermove", 45, 45);
  pointer("pointerup", 45, 45);
  assert.equal(editor.hasPaint(), true, "brush paints a mask");
  assert.equal(controls.undo.disabled, false);
  editor.keydown({ ctrlKey: true, metaKey: false, key: "z", preventDefault() {} });
  assert.equal(editor.hasPaint(), false, "Ctrl+Z restores the previous mask");
  assert.equal(controls.redo.disabled, false);
  editor.keydown({ ctrlKey: true, metaKey: false, shiftKey: true, key: "z", preventDefault() {} });
  assert.equal(editor.hasPaint(), true, "Ctrl+Shift+Z restores the undone stroke");
  editor.mode = "eraser";
  pointer("pointerdown", 15, 15);
  pointer("pointerup", 15, 15);
  assert.equal(editor.hasPaint(), false, "eraser removes painted areas");
  editor.mode = "rectangle";
  pointer("pointerdown", 10, 10);
  pointer("pointermove", 70, 60);
  pointer("pointerup", 70, 60);
  assert.equal(editor.hasPaint(), true, `rectangle draws a mask region (mask=${JSON.stringify(editor.mask?.hasPaint)}, history=${editor.history.length}, mode=${editor.mode})`);
  const plain = JSON.parse(await (await editor.blob(0, false)).text());
  assert.deepEqual(plain, [255, 255, 255, 255], "normal mask exports white repaint pixels");
  const inverted = JSON.parse(await (await editor.blob(8, true)).text());
  assert.deepEqual(inverted, [0, 0, 0, 255], "inverted feathered mask exports black repaint pixels for the painted source region");
  editor.undo();
  editor.redo();
  editor.clear();
  assert.equal(editor.hasPaint(), false, "clear removes mask");
  await assert.rejects(editor.blob(0, false), /empty-mask/);
  console.log("panel-retouch: brush/rectangle/eraser, undo/redo, inverted mask export passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
