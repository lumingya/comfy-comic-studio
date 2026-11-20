(() => {
  const ns = "http://www.w3.org/2000/svg";
  class MaskEditor {
    constructor(image, svg, field) {
      Object.assign(this, {
        image,
        svg,
        field,
        boxes: [],
        polygons: [],
        points: [],
        start: null,
        history: [],
      });
      this.mode = "rectangle";
      svg.addEventListener("pointerdown", (event) => {
        if (!image.naturalWidth || !image.hasAttribute("src")) return;
        event.preventDefault();
        if (this.mode === "polygon") this.points.push(this.point(event));
        else {
          this.start = this.point(event);
          svg.setPointerCapture(event.pointerId);
        }
        this.draw();
      });
      svg.addEventListener("pointermove", (event) => {
        if (this.start) this.draw(this.box(this.start, this.point(event)));
      });
      svg.addEventListener("pointerup", (event) => {
        if (!this.start) return;
        const box = this.box(this.start, this.point(event));
        this.start = null;
        if (box[2] - box[0] > 0.002 && box[3] - box[1] > 0.002) {
          this.boxes.push(box);
          this.history.push("boxes");
        }
        this.save();
      });
      svg.addEventListener("pointercancel", () => {
        this.start = null;
        this.draw();
      });
    }
    point(event) {
      const rect = this.svg.getBoundingClientRect();
      return [
        Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      ];
    }
    box(a, b) {
      return [
        Math.min(a[0], b[0]),
        Math.min(a[1], b[1]),
        Math.max(a[0], b[0]),
        Math.max(a[1], b[1]),
      ];
    }
    finish() {
      if (this.points.length < 3)
        throw new Error("请点击至少三个顶点后完成多边形。");
      this.polygons.push(this.points);
      this.history.push("polygons");
      this.points = [];
      this.save();
    }
    clear() {
      this.boxes = [];
      this.polygons = [];
      this.points = [];
      this.start = null;
      this.history = [];
      this.save();
    }
    undo() {
      if (this.points.length) this.points.pop();
      else {
        const type = this.history.pop();
        if (type) this[type].pop();
      }
      this.save();
    }
    save() {
      this.field.value = JSON.stringify({
        boxes: this.boxes,
        polygons: this.polygons,
      });
      this.draw();
      this.field.dispatchEvent(new Event("input"));
    }
    read() {
      return window.MioRetouchLogic.mask(JSON.parse(this.field.value));
    }
    draw(preview) {
      this.svg.replaceChildren();
      const append = (type, attrs) => {
        const element = document.createElementNS(ns, type);
        for (const [key, value] of Object.entries(attrs))
          element.setAttribute(key, value);
        this.svg.append(element);
      };
      for (const [x, y, right, bottom] of [
        ...this.boxes,
        ...(preview ? [preview] : []),
      ])
        append("rect", { x, y, width: right - x, height: bottom - y });
      for (const polygon of [
        ...this.polygons,
        ...(this.points.length ? [this.points] : []),
      ])
        append("polygon", {
          points: polygon.map((p) => p.join(",")).join(" "),
        });
      for (const [cx, cy] of this.points)
        append("circle", { cx, cy, r: 0.006 });
    }
    applyText() {
      const value = this.read();
      this.boxes = value.boxes;
      this.polygons = value.polygons;
      this.points = [];
      this.history = [
        ...value.boxes.map(() => "boxes"),
        ...value.polygons.map(() => "polygons"),
      ];
      this.draw();
    }
  }
  window.MioMaskEditor = MaskEditor;
})();
