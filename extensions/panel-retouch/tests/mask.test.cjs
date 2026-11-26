const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeContext {
  constructor(canvas) { this.canvas = canvas; this.globalCompositeOperation = "source-over"; }
  drawImage(source) { if (source?.hasPaint !== undefined) this.canvas.hasPaint = source.hasPaint; }
  setTransform() {}
  fillRect(...rect) { this.canvas.lastRect = rect; if (rect[2] && rect[3]) this.canvas.hasPaint = this.globalCompositeOperation !== "destination-out"; }
  stroke() { this.canvas.lastSegment = [this.from, this.to]; this.canvas.hasPaint = this.globalCompositeOperation === "destination-out" ? false : true; }
  beginPath() {}
  moveTo(x, y) { this.from = { x, y }; }
  lineTo(x, y) { this.to = { x, y }; }
  arc() {}
  save() { this.savedOperation = this.globalCompositeOperation; }
  restore() { if (this.savedOperation) this.globalCompositeOperation = this.savedOperation; }
  setLineDash() {}
  strokeRect() {}
  clearRect() { this.canvas.hasPaint = false; }
  getImageData() { return { data: new Uint8ClampedArray([255, 255, 255, this.canvas.hasPaint ? 255 : 0]) }; }
  putImageData(value) { this.canvas.pixels = Array.from(value.data); this.canvas.hasPaint = value.data[3] > 0; }
}
class FakeCanvas {
  constructor() { this.width = 10; this.height = 10; this.listeners = {}; this.hasPaint = false; this.context = new FakeContext(this); this.style = {}; this.rect = { left: 0, top: 0, width: 100, height: 100 }; }
  getContext() { return this.context; }
  getBoundingClientRect() { return this.rect; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  setPointerCapture() {}
  focus() { this.listeners.focus?.(); }
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
  const stage = { style: {}, getBoundingClientRect: () => ({ width: 100 }) };
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

  image.naturalWidth = 320;
  image.naturalHeight = 160;
  const position = { textContent: "" };
  controls.position = position;
  controls.text = (key, vars) => JSON.stringify({ key, ...vars });
  editor.reset();
  canvas.focus();
  const key = (value, extra = {}) => {
    let prevented = false;
    canvas.listeners.keydown({ key: value, preventDefault() { prevented = true; }, ...extra });
    return prevented;
  };
  const point = () => JSON.parse(JSON.stringify(editor.cursor));
  assert.deepEqual(point(), { x: 160, y: 80 }, "keyboard cursor starts in the image center");
  assert.match(position.textContent, /maskIdle/);
  assert.equal(key("ArrowRight"), true);
  key("ArrowDown", { shiftKey: true });
  assert.deepEqual(point(), { x: 161, y: 90 }, "keyboard movement uses source pixels, independent of display scale");
  assert.equal(editor.hasPaint(), false, "focus and cursor movement never become mask pixels");
  await assert.rejects(editor.blob(), /empty-mask/);

  editor.mode = "brush";
  const revision = editor.revision;
  key(" ");
  assert.equal(editor.hasPaint(), true, "Space stamps real mask content");
  assert.equal(editor.history.length, 0, "an unfinished keyboard stroke is not split into history entries");
  assert.match(position.textContent, /maskDrawing/);
  key(" ", { repeat: true });
  assert.equal(editor.drawing, true, "holding Space cannot repeatedly start and finish strokes");
  pointer("pointerup", 0, 0);
  assert.equal(editor.drawing, true, "pointer events cannot finish a keyboard stroke");
  key("ArrowRight", { shiftKey: true });
  assert.deepEqual(JSON.parse(JSON.stringify(editor.mask.lastSegment)), [{ x: 161, y: 90 }, { x: 171, y: 90 }]);
  key("Enter");
  assert.equal(editor.drawing, false);
  assert.equal(editor.history.length, 1, "a keyboard gesture is one undoable stroke");
  assert.equal(editor.revision, revision + 1);
  key("z", { ctrlKey: true });
  assert.equal(editor.hasPaint(), false);
  assert.equal(controls.redo.disabled, false);
  key("z", { metaKey: true, shiftKey: true });
  assert.equal(editor.hasPaint(), true);

  editor.mode = "eraser";
  key("Enter");
  key("ArrowLeft");
  key("Enter");
  assert.equal(editor.hasPaint(), false, "keyboard eraser removes mask pixels");
  editor.undo();
  assert.equal(editor.hasPaint(), true, "erasing remains a separate undo unit");
  editor.redo();
  assert.equal(editor.hasPaint(), false);

  editor.reset();
  editor.mode = "rectangle";
  key(" ");
  key("ArrowRight", { shiftKey: true });
  key("ArrowDown", { shiftKey: true });
  assert.equal(editor.hasPaint(), false, "rectangle movement previews without committing mask pixels");
  key("Enter");
  assert.equal(editor.hasPaint(), true, "keyboard rectangle creates a mask region");
  assert.deepEqual(editor.mask.lastRect, [160, 80, 11, 11], "keyboard rectangle includes its two corner pixels");
  assert.equal(editor.history.length, 1);
  const cursorBeforeResize = point();
  canvas.rect.width = 50;
  editor.resize();
  assert.deepEqual(point(), cursorBeforeResize, "resize preserves the source-space keyboard cursor");
  assert.equal(editor.hasPaint(), true, "resize preserves mask content");
  editor.undo();
  assert.equal(editor.hasPaint(), false);
  editor.redo();
  assert.equal(editor.hasPaint(), true);
  const keyboardPng = JSON.parse(await (await editor.blob(0, false)).text());
  assert.deepEqual(keyboardPng, [255, 255, 255, 255], "keyboard regions use the existing PNG submission path");

  editor.reset();
  editor.mode = "brush";
  key("Enter");
  key("ArrowRight");
  key("Escape");
  assert.equal(editor.hasPaint(), false, "Escape rolls back a whole keyboard stroke");
  assert.equal(editor.history.length, 0);
  key(" ");
  key("ArrowDown");
  canvas.listeners.blur();
  assert.equal(editor.drawing, false, "Tab/blur finishes a keyboard stroke so controls and submission stay available");
  assert.equal(editor.hasPaint(), true);
  assert.equal(editor.history.length, 1);
  assert.equal(position.textContent, "", "leaving the canvas hides stale cursor instructions");
  editor.undo();
  assert.equal(editor.hasPaint(), false);

  canvas.focus();
  for (let index = 0; index < 40; index++) key("ArrowRight", { shiftKey: true });
  for (let index = 0; index < 20; index++) key("ArrowUp", { shiftKey: true });
  assert.deepEqual(point(), { x: 319, y: 0 }, "keyboard cursor clamps to image pixels");
  const boundary = point();
  assert.equal(key("ArrowLeft", { altKey: true }), false, "modified browser navigation is not captured");
  assert.deepEqual(point(), boundary);
  editor.mode = "rectangle";
  key("Enter");
  key("Enter");
  assert.deepEqual(editor.mask.lastRect, [319, 0, 1, 1], "a stationary keyboard rectangle still selects one pixel");
  editor.reset();
  editor.mode = "brush";
  pointer("pointerdown", 25, 25);
  pointer("pointermove", 50, 50);
  pointer("pointerup", 50, 50);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.mask.lastSegment)), [{ x: 320, y: 80 }, { x: 320, y: 80 }], "pointer drawing retains its current display-to-image transform");
  assert.equal(editor.history.length, 1);
  image.naturalWidth = image.naturalHeight = 0;
  editor.reset();
  assert.equal(key("Enter"), false, "keyboard drawing waits for a loaded image");
  assert.equal(editor.drawing, false);
  console.log("panel-retouch: pointer/keyboard brush, rectangle and eraser; grouped undo/redo, cancellation, bounds, resize and mask export passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
