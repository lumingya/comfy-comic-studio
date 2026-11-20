/* Pure request construction, also exercised offline by logic.test.cjs. */
(() => {
  const finite = (value, min, max, label) => {
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "string" && !value.trim())
    )
      throw new Error(`${label}必须为数字。`);
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max)
      throw new Error(`${label}应在 ${min}–${max} 之间。`);
    return number;
  };
  const integer = (value, min, max, label) => {
    const number = finite(value, min, max, label);
    if (!Number.isInteger(number)) throw new Error(`${label}必须为整数。`);
    return number;
  };
  const point = (value) => {
    if (!Array.isArray(value) || value.length !== 2)
      throw new Error("蒙版顶点必须是 [x,y]。");
    return value.map((n) => finite(n, 0, 1, "蒙版坐标"));
  };
  const mask = (raw) => {
    if (
      !raw ||
      typeof raw !== "object" ||
      !Array.isArray(raw.boxes) ||
      !Array.isArray(raw.polygons)
    )
      throw new Error("蒙版格式应为 {boxes:[],polygons:[]}。");
    if (raw.boxes.length + raw.polygons.length > 64)
      throw new Error("一次最多使用 64 个蒙版区域。");
    const boxes = raw.boxes.map((box) => {
      if (!Array.isArray(box) || box.length !== 4)
        throw new Error("矩形格式应为 [左,上,右,下]。");
      const clean = box.map((n) => finite(n, 0, 1, "蒙版坐标"));
      if (clean[2] <= clean[0] || clean[3] <= clean[1])
        throw new Error("矩形必须具有正的宽度和高度。");
      return clean;
    });
    const polygons = raw.polygons.map((polygon) => {
      if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 128)
        throw new Error("多边形需要 3–128 个顶点。");
      const points = polygon.map(point);
      const area = points.reduce((sum, p, index) => {
        const next = points[(index + 1) % points.length];
        return sum + p[0] * next[1] - next[0] * p[1];
      }, 0);
      if (Math.abs(area) < 1e-6) throw new Error("多边形必须围出有效区域。");
      return points;
    });
    return { boxes, polygons };
  };
  const body = (input) => {
    if (!input.take_id || !input.profile_id)
      throw new Error("请先读取并选择候选和出图配置。");
    const params = {};
    if (input.kind === "inpaint") {
      Object.assign(params, mask(input.mask));
      if (!params.boxes.length && !params.polygons.length)
        throw new Error("请画出至少一个需要重绘的区域。");
      params.feather = integer(input.feather, 0, 128, "羽化像素");
    } else if (input.kind === "outpaint") {
      if (!Array.isArray(input.pads) || input.pads.length !== 4)
        throw new Error("外扩需要左、上、右、下四个边距。");
      params.pads = input.pads.map((n) => integer(n, 0, 2048, "外扩像素"));
      if (!params.pads.some(Boolean)) throw new Error("请至少扩展一条边。");
    } else if (input.kind === "edit") {
      params.instruction = input.instruction.trim();
      if (!params.instruction || params.instruction.length > 10000)
        throw new Error("请填写 1–10000 字的修改指令。");
      if (input.channel?.trim()) params.channel = input.channel.trim();
    } else throw new Error("未知的编辑方式。");
    for (const key of ["prompt", "negative"])
      if (input[key]?.trim()) params[key] = input[key].trim();
    if (input.denoise !== "")
      params.denoise = finite(input.denoise, 0, 1, "重绘强度");
    if (input.seed !== "")
      params.seed = integer(input.seed, 0, 2 ** 48 - 1, "种子");
    return {
      take_id: input.take_id,
      profile_id: input.profile_id,
      kind: input.kind,
      params,
    };
  };
  globalThis.MioRetouchLogic = Object.freeze({ body, mask });
})();
