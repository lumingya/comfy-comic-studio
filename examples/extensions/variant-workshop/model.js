/* Native VariantSet construction; no second persistence model or implicit generation. */
(() => {
  const fields = [
    "appearance",
    "description",
    "tag_description",
    "signature",
    "references",
    "outfits",
    "loras",
    "trigger",
  ];
  function derive(
    series,
    styleIds,
    characterIds,
    targetId,
    prefix,
    makeId = () => `var_${crypto.randomUUID().replaceAll("-", "")}`,
  ) {
    const styles = styleIds.length
      ? styleIds.map((id) => {
          const style = series.bible.styles.find((entry) => entry.id === id);
          if (!style) throw new Error("画风已改变，请重新读取作品。");
          return style;
        })
      : [null];
    const characters = characterIds.length
      ? characterIds.map((id) => {
          const character = series.bible.characters.find(
            (entry) => entry.id === id,
          );
          if (!character) throw new Error("角色已改变，请重新读取作品。");
          return character;
        })
      : [null];
    if (
      characterIds.length &&
      !series.bible.characters.some((entry) => entry.id === targetId)
    ) {
      throw new Error("请选择要替换外观的角色。");
    }
    if (styles.length * characters.length > 24)
      throw new Error("每次最多派生 24 个版本，请减少选择。");
    const variants = [];
    for (const style of styles)
      for (const character of characters) {
        const name =
          [prefix.trim(), style?.name, character?.name]
            .filter(Boolean)
            .join(" · ") || "新版本";
        const overrides = {};
        if (character)
          overrides[targetId] = Object.fromEntries(
            fields
              .filter((key) => key in character)
              .map((key) => [key, structuredClone(character[key])]),
          );
        variants.push({
          id: makeId(),
          name,
          characters: overrides,
          style_id: style?.id ?? null,
          profile_id: null,
        });
      }
    return variants;
  }
  function candidates(episode, panelId, variantId) {
    return episode.takes.filter(
      (take) =>
        take.panel_id === panelId &&
        (variantId === "*" || (take.variant_id ?? null) === variantId),
    );
  }
  globalThis.variantModel = { derive, candidates };
})();
