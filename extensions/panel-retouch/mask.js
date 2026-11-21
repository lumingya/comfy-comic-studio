(() => {
  class MaskEditor {
    constructor(image, canvas, stage, controls) {
      this.image = image;
      this.canvas = canvas;
      this.stage = stage;
      this.controls = controls;
      this.ctx = canvas.getContext("2d");
      this.mode = "brush";
      this.brushSize = 32;
      this.drawing = false;
      this.start = null;
      this.anchor = null;
      this.current = null;
      this.activeBefore = null;
      this.history = [];
      this.redoStack = [];
      this.revision = 0;
      this.mask = null;
      this.image.addEventListener("load", () => this.resize());
      this.canvas.addEventListener("pointerdown", (event) => this.pointerDown(event));
      this.canvas.addEventListener("pointermove", (event) => this.pointerMove(event));
      this.canvas.addEventListener("pointerup", (event) => this.pointerUp(event));
      this.canvas.addEventListener("pointercancel", () => this.cancelStroke());
      this.canvas.addEventListener("keydown", (event) => this.keydown(event));
      new ResizeObserver(() => this.resize()).observe(stage);
      this.render();
    }
    get width() { return this.image.naturalWidth || 1; }
    get height() { return this.image.naturalHeight || 1; }
    get canEdit() { return Boolean(this.image.naturalWidth && this.image.naturalHeight); }
    snapshot() {
      if (!this.mask) return null;
      const clone = document.createElement("canvas");
      clone.width = this.width;
      clone.height = this.height;
      clone.getContext("2d").drawImage(this.mask, 0, 0);
      return clone;
    }
    record() {
      this.history.push(this.snapshot());
      this.revision += 1;
      if (this.history.length > 40) this.history.shift();
      this.redoStack = [];
      this.updateHistory();
    }
    commitStroke() {
      this.history.push(this.activeBefore);
      if (this.history.length > 40) this.history.shift();
      this.redoStack = [];
      this.activeBefore = null;
      this.revision += 1;
      this.updateHistory();
    }
    updateHistory() {
      this.controls.undo.disabled = this.history.length === 0;
      this.controls.redo.disabled = this.redoStack.length === 0;
      this.controls.clear.disabled = !this.hasPaint();
    }
    hasPaint() {
      if (!this.mask) return false;
      const data = this.mask.getContext("2d").getImageData(0, 0, this.width, this.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i]) return true;
      return false;
    }
    resize() {
      const rect = this.stage.getBoundingClientRect();
      if (!rect.width || !this.canEdit) return;
      const height = Math.max(1, rect.width * this.height / this.width);
      this.stage.style.height = `${height}px`;
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      this.canvas.width = Math.round(rect.width * ratio);
      this.canvas.height = Math.round(height * ratio);
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      this.render();
    }
    point(event) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(this.width, (event.clientX - rect.left) * this.width / rect.width)),
        y: Math.max(0, Math.min(this.height, (event.clientY - rect.top) * this.height / rect.height))
      };
    }
    pointerDown(event) {
      if (!this.canEdit || event.button !== 0) return;
      event.preventDefault();
      this.canvas.focus({ preventScroll: true });
      this.canvas.setPointerCapture?.(event.pointerId);
      this.drawing = true;
      this.start = this.point(event);
      this.anchor = this.start;
      this.current = this.start;
      this.activeBefore = this.snapshot();
      if (this.mode !== "rectangle") {
        this.paintSegment(this.start, this.start);
      }
      this.render();
    }
    pointerMove(event) {
      if (!this.drawing) return;
      this.current = this.point(event);
      if (this.mode === "rectangle") this.render();
      else this.paintSegment(this.start, this.current);
      this.start = this.current;
      if (this.mode !== "rectangle") this.render();
    }
    pointerUp(event) {
      if (!this.drawing) return;
      const end = this.point(event);
      if (this.mode === "rectangle") {
        this.ensureMask();
        const context = this.mask.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(Math.min(this.anchor.x, end.x), Math.min(this.anchor.y, end.y), Math.abs(end.x - this.anchor.x), Math.abs(end.y - this.anchor.y));
      } else {
        this.paintSegment(this.start, end);
      }
      this.commitStroke();
      this.drawing = false;
      this.start = null;
      this.anchor = null;
      this.current = null;
      this.render();
      this.updateHistory();
    }
    cancelStroke() {
      if (!this.drawing) return;
      this.mask = this.activeBefore;
      this.activeBefore = null;
      this.drawing = false;
      this.start = null;
      this.anchor = null;
      this.current = null;
      this.render();
      this.updateHistory();
    }
    ensureMask() {
      if (this.mask && this.mask.width === this.width && this.mask.height === this.height) return;
      const next = document.createElement("canvas");
      next.width = this.width;
      next.height = this.height;
      if (this.mask) next.getContext("2d").drawImage(this.mask, 0, 0, this.width, this.height);
      this.mask = next;
    }
    paintSegment(a, b) {
      this.ensureMask();
      const context = this.mask.getContext("2d");
      context.save();
      context.globalCompositeOperation = this.mode === "eraser" ? "destination-out" : "source-over";
      context.strokeStyle = "#fff";
      context.fillStyle = "#fff";
      context.lineWidth = this.brushSize;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
      context.restore();
    }
    undo() {
      if (!this.history.length) return;
      this.redoStack.push(this.snapshot());
      this.mask = this.history.pop();
      this.revision += 1;
      this.render();
      this.updateHistory();
    }
    redo() {
      if (!this.redoStack.length) return;
      this.history.push(this.snapshot());
      this.mask = this.redoStack.pop();
      this.revision += 1;
      this.render();
      this.updateHistory();
    }
    clear() {
      if (!this.hasPaint()) return;
      this.record();
      this.mask = null;
      this.render();
      this.updateHistory();
    }
    keydown(event) {
      if (event.key === "Escape" && this.drawing) {
        event.preventDefault();
        this.cancelStroke();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) this.redo(); else this.undo();
    }
    render() {
      const rect = this.canvas.getBoundingClientRect();
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      this.ctx.clearRect(0, 0, rect.width, rect.height);
      if (this.mask) {
        const inverted = Boolean(this.controls.invert?.checked);
        this.ctx.save();
        this.ctx.globalAlpha = .4;
        this.ctx.fillStyle = "#f0b94e";
        if (inverted) {
          this.ctx.fillRect(0, 0, rect.width, rect.height);
          this.ctx.globalCompositeOperation = "destination-out";
          this.ctx.drawImage(this.mask, 0, 0, rect.width, rect.height);
        } else {
          this.ctx.drawImage(this.mask, 0, 0, rect.width, rect.height);
          this.ctx.globalCompositeOperation = "source-in";
          this.ctx.fillRect(0, 0, rect.width, rect.height);
        }
        this.ctx.restore();
      }
      if (this.drawing && this.mode === "rectangle" && this.anchor && this.current) {
        const scaleX = rect.width / this.width;
        const scaleY = rect.height / this.height;
        this.ctx.strokeStyle = "#fff0b8";
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([5, 4]);
        this.ctx.strokeRect(
          Math.min(this.anchor.x, this.current.x) * scaleX,
          Math.min(this.anchor.y, this.current.y) * scaleY,
          Math.abs(this.current.x - this.anchor.x) * scaleX,
          Math.abs(this.current.y - this.anchor.y) * scaleY
        );
        this.ctx.setLineDash([]);
      }
    }
    reset() {
      this.history = [];
      this.redoStack = [];
      this.mask = null;
      this.revision += 1;
      this.drawing = false;
      this.render();
      this.updateHistory();
    }
    async blob(feather = 0, invert = false) {
      if (!this.mask || !this.hasPaint()) throw new Error("empty-mask");
      const canvas = document.createElement("canvas");
      canvas.width = this.width;
      canvas.height = this.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(this.mask, 0, 0);
      if (invert) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const alpha = pixels.data[i + 3];
          pixels.data[i] = 255;
          pixels.data[i + 1] = 255;
          pixels.data[i + 2] = 255;
          pixels.data[i + 3] = 255 - alpha;
        }
        context.putImageData(pixels, 0, 0);
      }
      if (feather > 0) {
        const blur = document.createElement("canvas");
        blur.width = canvas.width;
        blur.height = canvas.height;
        const blurContext = blur.getContext("2d");
        blurContext.filter = `blur(${Math.max(0, Math.min(128, feather)) / 2}px)`;
        blurContext.drawImage(canvas, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(blur, 0, 0);
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const alpha = pixels.data[i + 3];
        pixels.data[i] = alpha;
        pixels.data[i + 1] = alpha;
        pixels.data[i + 2] = alpha;
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("mask-encode")), "image/png"));
    }
  }
  window.MioMaskEditor = MaskEditor;
})();
