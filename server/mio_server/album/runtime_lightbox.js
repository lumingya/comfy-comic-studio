function element(tag, className, label) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (label) el.textContent = label;
  return el;
}
function button(label, action, className) {
  const el = element("button", className, label);
  el.type = "button";
  el.addEventListener("click", action);
  return el;
}
function imageSource(image) {
  const src = image?.currentSrc || image?.getAttribute("src") || "";
  return /^data:image\//i.test(src) ? src : "";
}
function clamp(index, count) {
  return Math.max(0, Math.min(count - 1, index));
}
function mountAlbumLightbox(body, frames, name, source, motion, wake, element, button) {
  const pictures = frames.filter(({ image }) => source(image));
  if (!pictures.length) return null;
  let selected = 0;
  let returnFocus;
  let overflow;
  let background = [];
  const dialog = element("div", "cc-lightbox");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.hidden = true;
  const close = button("×", hide, "cc-lightbox-close");
  close.setAttribute("aria-label", "关闭画作预览");
  const zoom = button(
    "放大",
    () => setZoom(!viewport.hasAttribute("data-zoomed")),
    "cc-lightbox-zoom",
  );
  const previous = button("‹", () => move(-1), "cc-lightbox-previous");
  previous.setAttribute("aria-label", "上一幅画作");
  const next = button("›", () => move(1), "cc-lightbox-next");
  next.setAttribute("aria-label", "下一幅画作");
  const figure = element("figure");
  const viewport = element("div", "cc-lightbox-viewport");
  const preview = element("img");
  const caption = element("figcaption");
  viewport.append(preview);
  figure.append(viewport, caption);
  dialog.append(close, zoom, previous, figure, next);
  body.append(dialog);

  function setZoom(enabled) {
    viewport.toggleAttribute("data-zoomed", enabled);
    viewport.tabIndex = enabled ? 0 : -1;
    viewport.scrollTop = viewport.scrollLeft = 0;
    zoom.textContent = enabled ? "适应窗口" : "放大";
    zoom.setAttribute("aria-pressed", String(enabled));
  }
  function update() {
    const { panel, image } = pictures[selected];
    const url = source(image);
    if (url) preview.src = url;
    else preview.removeAttribute("src");
    preview.alt = image.alt || name(frames.indexOf(pictures[selected]));
    caption.textContent = body.hasAttribute("data-mio-immersive")
      ? ""
      : panel.querySelector("[data-cc-caption]")?.textContent.trim() || "";
    previous.disabled = selected === 0;
    next.disabled = selected === pictures.length - 1;
    dialog.setAttribute(
      "aria-label",
      preview.alt + "，" + (selected + 1) + " / " + pictures.length,
    );
    setZoom(false);
  }
  function move(direction) {
    const target = Math.max(0, Math.min(pictures.length - 1, selected + direction));
    if (target === selected) return;
    selected = target;
    update();
    if (document.activeElement?.disabled) close.focus();
  }
  function open(index, trigger) {
    if (!dialog.hidden) return;
    selected = index;
    returnFocus = trigger;
    overflow = body.style.overflow;
    body.style.overflow = "hidden";
    background = [...body.children].filter((el) => el !== dialog && !el.hasAttribute("inert"));
    background.forEach((el) => el.setAttribute("inert", ""));
    update();
    dialog.hidden = false;
    dialog.style.transition = motion?.matches ? "none" : "opacity 160ms ease";
    close.focus();
    wake();
  }
  function hide() {
    if (dialog.hidden) return;
    dialog.hidden = true;
    background.forEach((el) => el.removeAttribute("inert"));
    background = [];
    body.style.overflow = overflow;
    returnFocus?.focus({ preventScroll: true });
    wake();
  }
  pictures.forEach(({ panel, image }, index) => {
    const explicit = panel.querySelector("[data-ag-view]");
    image.tabIndex = explicit ? -1 : 0;
    if (!explicit) {
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", "打开画作预览：" + (image.alt || "画作"));
      image.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open(index, image);
      });
    }
    image.addEventListener("click", (event) => {
      event.preventDefault();
      open(index, explicit || image);
    });
    explicit?.addEventListener("click", () => open(index, explicit));
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) hide();
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (dialog.hidden || event.defaultPrevented) return;
      if (event.key === "Escape") hide();
      else if (event.key === "ArrowLeft" && document.activeElement !== viewport) move(-1);
      else if (event.key === "ArrowRight" && document.activeElement !== viewport) move(1);
      else if (event.key === "Tab") {
        const stops = [close, zoom, previous, viewport, next].filter(
          (el) => !el.disabled && el.tabIndex >= 0,
        );
        const boundary = event.shiftKey ? stops[0] : stops.at(-1);
        if (document.activeElement !== boundary && dialog.contains(document.activeElement)) return;
        (event.shiftKey ? stops.at(-1) : stops[0]).focus();
      } else return;
      event.preventDefault();
    },
    true,
  );
  dialog.move = move;
  dialog.zoomed = () => !dialog.hidden && viewport.hasAttribute("data-zoomed");
  return dialog;
}
