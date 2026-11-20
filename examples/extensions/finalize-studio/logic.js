(() => {
  const eligible = (episode) =>
    episode.takes.filter(
      (take) => take.status === "adopted" && take.stage === "draft",
    );
  const body = (episode, ids, profile, consent) => {
    if (!consent) throw new Error("请先确认成品完成后的采用行为。");
    if (
      !profile ||
      profile.binding_required ||
      !profile.final?.some((stage) => stage.enabled !== false)
    )
      throw new Error("请选择含有效成品阶段的已绑定配置。");
    const selected = [...new Set(ids)];
    const allowed = new Set(eligible(episode).map((take) => take.id));
    if (!selected.length || selected.some((id) => !allowed.has(id)))
      throw new Error("只能提交明确选择的已采用草稿；请刷新后重新选择。");
    return { take_ids: selected, profile_id: profile.id };
  };
  const comparisons = (episode) =>
    episode.takes.filter(
      (take) =>
        take.stage === "final" &&
        take.parent_take_id &&
        episode.takes.some((parent) => parent.id === take.parent_take_id),
    );
  globalThis.MioFinalizeLogic = Object.freeze({ eligible, body, comparisons });
})();
