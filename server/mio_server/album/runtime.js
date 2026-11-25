(function () {
  const body = document.body;
  const layout = body.dataset.layout;
  const embedded = window.parent !== window;
  const mobile = window.matchMedia?.("(max-width:680px)");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const defaultPaged = ["flip", "folio", "cinema"].includes(layout);
  const zine =
    layout === "editorial" && !!body.querySelector(".zine[data-cc-book]");
  const modes = ["template", "single", "double"];
  let mode = "template";
  let current = 0;
  let reportTimer;
  let idleTimer;
  let scrollFrame;
  let navigationAnchor;
  let readingDirection = "ltr";
  let swipe;
  let lastSwipe = -Infinity;
  let lightbox;

  const books = [];
  const frames = [];
  for (const book of document.querySelectorAll("[data-cc-book]")) {
    const pages = book.querySelector("[data-cc-pages]");
    if (!pages) continue;
    const panels = [...pages.querySelectorAll("[data-cc-frame]")];
    if (!panels.length) continue;
    const entry = { book, pages, start: frames.length, count: panels.length };
    panels.forEach((panel) =>
      frames.push({ panel, image: panel.querySelector("img[src]"), entry }),
    );
    // Preserve the blank verso in legacy spreads without including it in navigation.
    if (panels.length % 2 && (layout === "manga" || defaultPaged)) {
      entry.blank = element("div", "cc-frame cc-blank", "留白");
      entry.blank.setAttribute("aria-hidden", "true");
      pages.append(entry.blank);
    }
    books.push(entry);
  }
  if (!frames.length) return;

  function isPaged() {
    return mode !== "template" || defaultPaged;
  }
  function perPage() {
    if (mode === "single" || (mode === "template" && layout === "cinema"))
      return 1;
    if (mode === "double") return 2;
    return mobile?.matches ? 1 : 2;
  }
  function frameName(index) {
    return frames[index].image?.alt || "第 " + (index + 1) + " 幕";
  }

  const ambient = element("div", "mio-ambient");
  ambient.setAttribute("aria-hidden", "true");
  const glowLayers = [element("div"), element("div")];
  ambient.append(...glowLayers);
  let glow = 0;
  let activePalette = "";
  const controls = element("nav", "mio-controls");
  controls.setAttribute("aria-label", "画册阅读控制");
  const previous = button("‹", () => turn(-1));
  previous.setAttribute("aria-label", "上一页");
  const next = button("›", () => turn(1));
  next.setAttribute("aria-label", "下一页");
  const counter = element("output", "mio-progress");
  counter.setAttribute("aria-live", "polite");
  const progress = element("progress");
  progress.max = frames.length;
  progress.setAttribute("aria-label", "阅读进度");
  const directory = button("目录", () => toggleTray(tray.hidden));
  directory.setAttribute("aria-expanded", "false");
  directory.setAttribute("aria-controls", "mio-reader-directory");
  const view = button("版式", () =>
    setMode(modes[(modes.indexOf(mode) + 1) % modes.length]),
  );
  let directionControl;
  if (zine) {
    directionControl = element("select", "mio-reading-direction");
    directionControl.setAttribute("aria-label", "独立志阅读方向");
    for (const [value, label] of [
      ["webtoon", "条漫"],
      ["ltr", "左翻"],
      ["rtl", "右翻"],
    ]) {
      const option = element("option", "", label);
      option.value = value;
      directionControl.append(option);
    }
    directionControl.addEventListener("change", () => {
      const value = directionControl.value;
      if (value !== "webtoon") readingDirection = value;
      setMode(
        value === "webtoon"
          ? "template"
          : mode === "template"
            ? mobile?.matches
              ? "single"
              : "double"
            : mode,
      );
    });
  }
  const immerse = button("无字", () => {
    immerse.setAttribute(
      "aria-pressed",
      String(body.toggleAttribute("data-mio-immersive")),
    );
  });
  immerse.setAttribute("aria-pressed", "false");
  controls.append(previous, counter, next, directory, view, immerse);
  if (directionControl) controls.append(directionControl);
  if (typeof document.documentElement.requestFullscreen === "function") {
    controls.append(button("全屏", toggleFullscreen));
  }
  controls.append(progress);
  const tray = element("aside", "mio-tray");
  tray.id = "mio-reader-directory";
  tray.setAttribute("aria-label", "分幕目录");
  tray.hidden = true;
  const trayHeader = element("header");
  const trayClose = button("关闭目录", () => toggleTray(false));
  const thumbnails = element("div", "mio-thumbnails");
  trayHeader.append(trayClose);
  tray.append(trayHeader, thumbnails);
  body.append(ambient, controls, tray);

  function spread() {
    const entry = frames[current].entry;
    const columns = perPage();
    const first = current - ((current - entry.start) % columns);
    return {
      first,
      end: Math.min(entry.start + entry.count, first + columns),
      entry,
    };
  }
  function updateChrome() {
    const { panel, entry } = frames[current];
    counter.value = current + 1 + " / " + frames.length;
    progress.value = current + 1;
    previous.disabled = isPaged()
      ? current < perPage() && entry === books[0]
      : current === 0;
    next.disabled = isPaged()
      ? spread().end === frames.length
      : current === frames.length - 1;
    thumbnails.querySelector("[aria-current]")?.removeAttribute("aria-current");
    thumbnails.children[current]?.setAttribute("aria-current", "true");
    const colors = [
      ...panel.querySelectorAll(
        ".palette i, .cc-palette i, [data-cc-palette] i",
      ),
    ]
      .slice(0, 3)
      .map((swatch) => swatch.style.backgroundColor)
      .filter((color) => color);
    // CSSOM returns the color component only, including when the declared background has an image.
    const palette = colors.length
      ? [0, 1, 2].map((index) => colors[index] || colors[0]).join(",")
      : "";
    if (palette !== activePalette) {
      activePalette = palette;
      glowLayers[glow].removeAttribute("data-visible");
      glow = 1 - glow;
      if (palette) {
        glowLayers[glow].style.background =
          "linear-gradient(135deg," + palette + ")";
        glowLayers[glow].setAttribute("data-visible", "");
      }
    }
  }
  function isRightToLeft() {
    return zine && isPaged() && readingDirection === "rtl";
  }
  function show(animate, direction = 1) {
    const paged = isPaged();
    const columns = perPage();
    const { entry, first, end } = spread();
    body.toggleAttribute("data-mio-paged", paged);
    if (zine) {
      body.dataset.mioDirection = paged ? readingDirection : "webtoon";
      directionControl.value = paged ? readingDirection : "webtoon";
      previous.textContent = isRightToLeft() ? "›" : "‹";
      next.textContent = isRightToLeft() ? "‹" : "›";
    }
    body.style.setProperty("--mio-columns", String(columns));
    for (const book of books) {
      book.book.hidden = paged && book !== entry;
      book.pages.toggleAttribute("data-mio-pair", paged && columns === 2);
      if (book.blank) {
        const showBlank = paged
          ? book === entry && columns === 2 && end === entry.start + entry.count
          : layout === "manga";
        book.blank.hidden = !showBlank;
      }
      for (const opening of book.book.querySelectorAll(
        ".edition-cover,.edition-opening,.edition-chapter,.cc-cover",
      )) {
        opening.hidden = paged && (book !== entry || first !== book.start);
      }
      for (const closing of book.book.querySelectorAll(".edition-end")) {
        closing.hidden =
          paged && (book !== entry || end !== book.start + book.count);
      }
    }
    frames.forEach(({ panel }, index) => {
      panel.hidden = paged && (index < first || index >= end);
      panel.dataset.mioLeaf =
        ((index - first) % 2 === 0) !== isRightToLeft() ? "left" : "right";
      panel.removeAttribute("data-mio-enter");
      panel.removeAttribute("data-mio-turn");
    });
    if (animate && paged && !reducedMotion?.matches) {
      const leaf = frames[zine && direction < 0 ? first : end - 1].panel;
      void leaf.offsetWidth;
      if (zine)
        leaf.dataset.mioTurn =
          direction > 0 !== isRightToLeft() ? "left" : "right";
      leaf.setAttribute("data-mio-enter", "");
    }
    updateChrome();
  }
  function go(index, animate = true) {
    const direction = index < current ? -1 : 1;
    current = clamp(index, frames.length);
    const focused = document.activeElement?.closest("[data-cc-frame]");
    if (isPaged()) show(animate, direction);
    else updateChrome();
    if (focused?.hidden) frames[current].image?.focus({ preventScroll: true });
    const target = isPaged()
      ? frames[current].entry.pages
      : frames[current].panel;
    // Jump to the art without interpolating over large albums or skipping hidden spreads.
    window.scrollTo({
      top: target.getBoundingClientRect().top + window.scrollY,
      behavior: "instant",
    });
    // A final/short panel cannot always reach the scroll marker. Retain an explicit
    // selection at its actual clamped position, until the reader scrolls elsewhere.
    navigationAnchor = { frame: current, y: window.scrollY };
    wake();
    report();
  }
  function turn(direction) {
    let target = current + direction;
    if (isPaged()) {
      const columns = perPage();
      const { entry, first, end } = spread();
      target = direction < 0 ? first - columns : end;
      if (direction < 0 && first === entry.start) {
        const before = frames[first - 1]?.entry;
        target = before
          ? before.start + Math.floor((before.count - 1) / columns) * columns
          : 0;
      }
    }
    if (target >= 0 && target < frames.length && target !== current) go(target);
  }
  function updateMode(value) {
    mode = value;
    view.textContent = { template: "模板版式", single: "单页", double: "双页" }[
      mode
    ];
    view.setAttribute("aria-label", "切换版式（" + view.textContent + "）");
  }
  function setMode(value) {
    updateMode(value);
    show(false);
    go(current, false);
  }
  function toggleTray(open) {
    if (open && !thumbnails.children.length) {
      thumbnails.append(
        ...frames.map(({ image, entry }, index) => {
          const label = frameName(index);
          const chapter = entry.book.querySelector("h1,h2")?.textContent;
          const thumb = button(index + 1 + " · " + label, () => {
            go(index);
            toggleTray(false);
          });
          thumb.setAttribute(
            "aria-label",
            (chapter ? chapter + " · " : "") + (index + 1) + " · " + label,
          );
          const src = imageSource(image);
          if (src) {
            const preview = element("img");
            preview.src = src;
            preview.alt = "";
            preview.loading = "lazy";
            preview.decoding = "async";
            thumb.prepend(preview);
          }
          return thumb;
        }),
      );
    }
    tray.hidden = !open;
    directory.setAttribute("aria-expanded", String(open));
    updateChrome();
    wake();
    if (open) {
      thumbnails.children[current].focus();
      thumbnails.children[current].scrollIntoView?.({ block: "nearest" });
    } else {
      directory.focus();
    }
  }
  function wake() {
    controls.removeAttribute("data-idle");
    window.clearTimeout(idleTimer);
    if (tray.hidden && lightbox?.hidden !== false) {
      idleTimer = window.setTimeout(
        () => controls.setAttribute("data-idle", ""),
        3500,
      );
    }
  }
  function toggleFullscreen() {
    const result = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen?.();
    // Embedded previews may be denied fullscreen by the parent.
    result?.catch(() => {});
  }

  lightbox = mountAlbumLightbox(
    body,
    frames,
    frameName,
    imageSource,
    reducedMotion,
    wake,
    element,
    button,
  );
  updateMode(mode);
  show(false);
  wake();
  mobile?.addEventListener?.("change", () => {
    show(false);
    report();
  });
  document.addEventListener("pointermove", wake, { passive: true });
  document.addEventListener("focusin", wake);
  window.addEventListener(
    "scroll",
    () => {
      wake();
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = null;
        if (!isPaged()) {
          const anchored =
            navigationAnchor?.frame === current &&
            Math.abs(window.scrollY - navigationAnchor.y) <= 1;
          if (!anchored) navigationAnchor = null;
          const marker = Math.min(window.innerHeight / 3, 240);
          const { top, bottom } = frames[current].panel.getBoundingClientRect();
          // Adjacent panels on a contact sheet share a row. Keep the selected panel in that row.
          if (!anchored && (top > marker || bottom <= marker)) {
            const candidate = frames.findIndex(
              ({ panel }) => panel.getBoundingClientRect().bottom > marker,
            );
            current = candidate < 0 ? frames.length - 1 : candidate;
            updateChrome();
          }
        }
        report();
      });
    },
    { passive: true },
  );

  document.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const key = event.key.toLowerCase();
    if (key === "escape" && !tray.hidden) toggleTray(false);
    else if (
      event.target?.closest?.(
        "input,textarea,select,[contenteditable],.cc-lightbox",
      )
    )
      return;
    else if (key === "g") toggleTray(tray.hidden);
    else if (key === "f") toggleFullscreen();
    else if (key === "arrowleft" && tray.hidden) turn(isRightToLeft() ? 1 : -1);
    else if (key === "arrowright" && tray.hidden)
      turn(isRightToLeft() ? -1 : 1);
    else if (
      key === " " &&
      tray.hidden &&
      !event.target?.closest?.("button,a,[role=button]")
    ) {
      turn(event.shiftKey ? -1 : 1);
    } else if (key === "home" && tray.hidden) go(0);
    else if (key === "end" && tray.hidden) go(frames.length - 1);
    else return;
    event.preventDefault();
  });
  document.addEventListener(
    "touchstart",
    (event) => {
      wake();
      const touch = event.touches[0];
      const interactive = event.target?.closest?.(
        ".mio-controls,.mio-tray,button,a,input",
      );
      swipe =
        touch &&
        event.touches.length === 1 &&
        !interactive &&
        !lightbox?.zoomed?.()
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    },
    { passive: true },
  );
  document.addEventListener(
    "touchend",
    (event) => {
      const touch = event.changedTouches[0];
      const start = swipe;
      swipe = null;
      if (!start || !touch || event.touches.length) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      lastSwipe = performance.now();
      const direction = (dx < 0 ? 1 : -1) * (isRightToLeft() ? -1 : 1);
      if (lightbox && !lightbox.hidden) lightbox.move(direction);
      else turn(direction);
    },
    { passive: true },
  );
  document.addEventListener(
    "touchcancel",
    () => {
      swipe = null;
    },
    { passive: true },
  );
  document.addEventListener(
    "click",
    (event) => {
      if (
        performance.now() - lastSwipe < 250 &&
        event.target?.closest?.("[data-cc-frame]")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  function report() {
    if (!embedded) return;
    window.clearTimeout(reportTimer);
    reportTimer = window.setTimeout(
      () =>
        window.parent.postMessage(
          {
            type: "mio-reader-state",
            y: window.scrollY,
            spread: isPaged()
              ? Math.floor((current - frames[current].entry.start) / perPage())
              : 0,
            frame: current,
            mode,
          },
          "*",
        ),
      120,
    );
  }
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!embedded || event.source !== window.parent || !data) return;
    if (data.type === "mio-reader-turn") {
      if (data.direction !== 1 && data.direction !== -1) return;
      if (lightbox && !lightbox.hidden) lightbox.move(data.direction);
      else turn(data.direction);
    } else if (data.type === "mio-reader-restore") {
      if (modes.includes(data.mode)) updateMode(data.mode);
      if (Number.isSafeInteger(data.frame))
        current = clamp(data.frame, frames.length);
      else if (isPaged() && Number.isSafeInteger(data.spread)) {
        current = clamp(data.spread * perPage(), books[0].count);
      }
      show(false);
      const y = Number(data.y);
      window.scrollTo({
        top: Number.isFinite(y) ? Math.max(0, y) : 0,
        behavior: "instant",
      });
    }
  });
})();
