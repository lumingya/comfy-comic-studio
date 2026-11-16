"use strict";

(() => {
  const languageLink = document.querySelector("[data-language-link]");
  const syncLanguageAnchor = () => {
    if (!languageLink) return;
    const target = new URL(languageLink.href, window.location.href);
    target.hash = window.location.hash;
    languageLink.href = target.href;
  };
  syncLanguageAnchor();
  window.addEventListener("hashchange", syncLanguageAnchor);

  if (document.body.dataset.page === "home") {
    const links = Array.from(document.querySelectorAll(".guide-link"));
    // Bookmarks from the former single-page manual still open the same topic.
    const openBookmarkedChapter = () => {
      const section = window.location.hash.slice(1);
      const link = links.find((item) => item.dataset.section === section);
      if (link) window.location.replace(link.href + "#" + section);
    };
    openBookmarkedChapter();
    window.addEventListener("hashchange", openBookmarkedChapter);

    const search = document.getElementById("guide-search");
    const empty = document.getElementById("no-results");
    const filter = () => {
      const query = search.value.trim().toLocaleLowerCase();
      let count = 0;
      for (const link of links) {
        const matches = link.textContent.toLocaleLowerCase().includes(query);
        link.hidden = !matches;
        if (matches) count += 1;
      }
      empty.hidden = count > 0;
    };
    search.addEventListener("input", filter);
    // Browsers can restore a search value when navigating back to the directory.
    window.addEventListener("pageshow", filter);
    filter();
    document.addEventListener("keydown", (event) => {
      const target = document.activeElement;
      const editing =
        target?.matches("input, textarea, select") || target?.isContentEditable;
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !editing
      ) {
        event.preventDefault();
        search.focus();
      }
      if (event.key === "Escape" && target === search) {
        search.value = "";
        filter();
        search.blur();
      }
    });
  }

  if (document.body.dataset.page === "reader") {
    document
      .querySelector(".print-link")
      ?.addEventListener("click", () => window.print());
    const progress = document.getElementById("progress");
    const updateProgress = () => {
      const available =
        document.documentElement.scrollHeight - window.innerHeight;
      const ratio =
        available > 0
          ? Math.min(1, Math.max(0, window.scrollY / available))
          : 0;
      progress.style.transform = `scaleX(${ratio})`;
    };
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    updateProgress();
  }
})();
