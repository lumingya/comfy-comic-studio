(() => {
  const finite = (value, min, max, label) => {
    if (value === null || typeof value === "boolean" || (typeof value === "string" && !value.trim())) throw new Error(`${label}: number required`);
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label}: expected ${min}–${max}`);
    return number;
  };
  const integer = (value, min, max, label) => {
    const number = finite(value, min, max, label);
    if (!Number.isInteger(number)) throw new Error(`${label}: integer required`);
    return number;
  };
  const body = (input) => {
    if (!input.take_id || !input.profile_id) throw new Error("profileRequired");
    const params = {};
    if (input.kind === "inpaint") {
      if (!input.mask_asset_id) throw new Error("emptyMask");
      params.mask_asset_id = input.mask_asset_id;
      params.feather = integer(input.feather, 0, 128, "feather");
      params.invert = Boolean(input.invert);
    } else if (input.kind === "outpaint") {
      const padding = integer(input.padding, 8, 2048, "padding");
      const pads = { left: 0, top: 0, right: 0, bottom: 0 };
      if (["left", "right", "top", "bottom"].includes(input.direction)) pads[input.direction] = padding;
      else if (input.direction === "horizontal") pads.left = pads.right = padding;
      else if (input.direction === "vertical") pads.top = pads.bottom = padding;
      else if (input.direction === "all") pads.left = pads.top = pads.right = pads.bottom = padding;
      else throw new Error("direction");
      params.pads = [pads.left, pads.top, pads.right, pads.bottom];
    } else if (input.kind === "edit") {
      params.instruction = input.instruction.trim();
      if (!params.instruction || params.instruction.length > 10000) throw new Error("instruction");
      if (input.channel?.trim()) params.channel = input.channel.trim();
    } else throw new Error("kind");
    for (const key of ["prompt", "negative"]) if (input[key]?.trim()) params[key] = input[key].trim();
    if (input.denoise !== "") params.denoise = finite(input.denoise, 0, 1, "denoise");
    if (input.seed !== "") params.seed = integer(input.seed, 0, 2 ** 48 - 1, "seed");
    return { take_id: input.take_id, profile_id: input.profile_id, kind: input.kind, params };
  };
  const workflow = (profile, kind) => {
    const stage = profile?.edits?.[kind];
    if (profile?.binding_required) return false;
    return stage ? stage.enabled !== false : kind === "edit";
  };
  const results = (episode) => episode.takes.filter((take) => take.parent_take_id && take.edits?.some((edit) => ["inpaint", "outpaint", "edit"].includes(edit.kind)));
  window.MioRetouchLogic = Object.freeze({ body, workflow, results });
})();
