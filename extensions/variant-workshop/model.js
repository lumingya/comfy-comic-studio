/* Four independent axes produce native VariantSet snapshots, never render requests. */
(() => {
  const axes = ["character", "outfit", "scene", "style"];
  const keys = { character: "character", outfit: "outfit", scene: "scene", style: "style" };
  const fields = ["appearance", "description", "tag_description", "signature", "references", "loras", "trigger"];
  const canonical = (value) => JSON.stringify(normalize(value));
  function normalize(value) {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
    return value;
  }
  function usedByPanel(series, panel, key) {
    const values = { ...series.variables, ...Object.fromEntries(Object.entries(panel.overrides?.values ?? {}).filter(([name]) => name.startsWith("$")).map(([name, value]) => [name.slice(1), String(value)])) };
    if (Object.hasOwn(panel.overrides?.values ?? {}, `$${key}`)) return false;
    const seen = new Map();
    const visit = (text, depth = 0) => {
      for (const match of String(text ?? "").matchAll(/\{\{|\}\}|\{([^{}\s][^{}]{0,63})\}/g)) {
        if (!match[1]) continue;
        const name = match[1].trim();
        if (name === key) return true;
        if ((seen.get(name) ?? Infinity) <= depth) continue;
        seen.set(name, depth);
        if (depth < 4 && visit(values[name], depth + 1)) return true;
      }
      return false;
    };
    const ov = panel.overrides ?? {};
    const texts = ov.raw_prompt != null ? [ov.raw_prompt, ov.raw_negative] : [ov.append_prompt, ov.negative_prompt];
    return texts.some((text) => visit(text));
  }
  function options(series, episode, presets, mode, bindings = keys) {
    if (mode === "presets") {
      return Object.fromEntries(axes.map((axis) => [axis, presets.flatMap((preset) => {
        const entry = [...(preset.entries ?? [])].reverse().find((entry) => entry.key === bindings[axis]);
        if (!entry) return [];
        return [{ id: preset.id, name: preset.title, value: entry.value, affected: episode.panels.filter((panel) => usedByPanel(series, panel, bindings[axis])).length }];
      })]));
    }
    if (mode !== "bible") throw new Error("Unknown preset source.");
    return {
      character: (series.bible.characters ?? []).map((item) => ({ id: item.id, name: item.name, item })),
      outfit: (series.bible.characters ?? []).flatMap((character) => Object.entries(character.outfits ?? {}).map(([slot, tags]) => ({ id: JSON.stringify([character.id, slot]), name: `${character.name} · ${slot}`, tags }))),
      scene: (series.bible.locations ?? []).map((item) => ({ id: item.id, name: item.name, item })),
      style: (series.bible.styles ?? []).map((item) => ({ id: item.id, name: item.name, item })),
    };
  }
  function derive(series, episode, presets, selection, makeId = () => `var_${crypto.randomUUID().replaceAll("-", "")}`) {
    const bindings = selection.bindings ?? keys;
    const source = options(series, episode, presets, selection.mode, bindings);
    const choices = Object.fromEntries(axes.map((axis) => [axis, [...new Set(selection[axis] ?? [])].map((id) => {
      const choice = source[axis].find((item) => item.id === id);
      if (!choice) throw new Error("Preset changed. Reload the work.");
      if (selection.mode === "presets" && !choice.affected) throw new Error("The selected variable is not used by this episode’s prompts.");
      return choice;
    })]));
    if (!axes.some((axis) => choices[axis].length)) throw new Error("Choose at least one preset.");
    if (selection.mode === "presets") {
      const activeKeys = axes.filter((axis) => choices[axis].length).map((axis) => bindings[axis]);
      if (activeKeys.some((key) => !/^[^\s{}]{1,64}$/.test(key)) || new Set(activeKeys).size !== activeKeys.length)
        throw new Error("Each selected axis needs a different valid variable name.");
    }
    const target = series.bible.characters.find((item) => item.id === selection.targetCharacter);
    const location = (series.bible.locations ?? []).find((item) => item.id === selection.targetLocation);
    if (selection.mode === "bible") {
      if ((choices.character.length || choices.outfit.length) && (!target || !episode.panels.some((panel) => panel.overrides?.raw_prompt == null && panel.characters?.some((entry) => entry.character_id === target.id))))
        throw new Error("Choose a character used by a compiled panel.");
      if (choices.outfit.length && !episode.panels.some((panel) => panel.overrides?.raw_prompt == null && panel.characters?.some((entry) => entry.character_id === target.id && entry.outfit === selection.targetOutfit)))
        throw new Error("Choose an outfit slot used by the target character.");
      if (choices.scene.length && (!location || !episode.panels.some((panel) => panel.overrides?.raw_prompt == null && panel.location_id === location.id)))
        throw new Error("Choose a location used by a compiled panel.");
      if (choices.style.length && !episode.panels.some((panel) => panel.overrides?.raw_prompt == null))
        throw new Error("Use template variables for raw-prompt storyboards.");
    }
    const total = axes.reduce((count, axis) => count * Math.max(1, choices[axis].length), 1);
    if (total > 24) throw new Error("Choose fewer presets: at most 24 combinations per batch.");
    let combinations = [{}];
    for (const axis of axes) combinations = combinations.flatMap((entry) => (choices[axis].length ? choices[axis] : [null]).map((choice) => ({ ...entry, [axis]: choice })));
    const seen = new Set();
    return combinations.flatMap((combination) => {
      const variant = { name: [selection.prefix?.trim(), ...axes.map((axis) => combination[axis]?.name)].filter(Boolean).join(" · "), characters: {}, outfits: {}, locations: {}, variables: {}, style_id: null, profile_id: null };
      if (selection.mode === "presets") {
        for (const axis of axes) if (combination[axis]) variant.variables[bindings[axis]] = combination[axis].value;
      } else {
        if (combination.character) variant.characters[target.id] = Object.fromEntries(fields.filter((key) => key in combination.character.item).map((key) => [key, structuredClone(combination.character.item[key])]));
        if (combination.outfit) variant.outfits[target.id] = { [selection.targetOutfit]: structuredClone(combination.outfit.tags) };
        if (combination.scene) variant.locations[location.id] = Object.fromEntries(["name", "description", "tags", "time", "references"].filter((key) => key in combination.scene.item).map((key) => [key, structuredClone(combination.scene.item[key])]));
        if (combination.style) variant.style_id = combination.style.id;
      }
      const signature = canonical({ ...variant, name: "" });
      if (seen.has(signature)) return [];
      seen.add(signature);
      return [{ id: makeId(), ...variant }];
    });
  }
  function candidates(episode, panelId, variantId) {
    return episode.takes.filter((take) => take.panel_id === panelId && (variantId === "*" || (take.variant_id ?? null) === variantId));
  }
  function estimate(panelCount, variantCount, candidatesPerPanel) {
    if (![panelCount, variantCount, candidatesPerPanel].every(Number.isSafeInteger)) throw new Error("Counts must be integers.");
    const total = panelCount * variantCount * candidatesPerPanel;
    if (panelCount < 0 || variantCount < 0 || candidatesPerPanel < 1 || candidatesPerPanel > 16 || !Number.isSafeInteger(total)) throw new Error("Invalid render count.");
    return total;
  }
  function comparisonKey(variant, dimension, bindings = keys) {
    if (!axes.includes(dimension)) throw new Error("Unknown comparison axis.");
    const data = { characters: variant.characters ?? {}, outfits: variant.outfits ?? {}, locations: variant.locations ?? {}, style_id: variant.style_id ?? null, variables: { ...(variant.variables ?? {}) }, profile_id: variant.profile_id ?? null };
    delete data.variables[bindings[dimension]];
    if (dimension === "character") data.characters = {};
    if (dimension === "outfit") data.outfits = {};
    if (dimension === "scene") data.locations = {};
    if (dimension === "style") data.style_id = null;
    return canonical(data);
  }
  function variantsForDimension(variants, dimension, baseline, bindings = keys) {
    if (dimension === "all") return baseline ? variants.filter((variant) => variant.id === baseline.id) : [...variants];
    const target = baseline ? comparisonKey(baseline, dimension, bindings) : null;
    return variants.filter((variant) => target === null || comparisonKey(variant, dimension, bindings) === target).sort((a, b) => comparisonKey(a, dimension, bindings).localeCompare(comparisonKey(b, dimension, bindings)));
  }
  globalThis.variantModel = { axes, keys, options, derive, candidates, estimate, comparisonKey, variantsForDimension };
})();
