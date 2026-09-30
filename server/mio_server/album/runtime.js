(function () {
  // Mio album reader — the legacy compiledBookRuntime (ui-templates.js):
  // * manga: two-page spreads side by side, an odd book gets a blank end paper; it scrolls.
  // * flip:  turns one spread at a time (one scene on phones), left to right like any book:
  //          「上一跨页」 on the left, 「下一跨页」 on the right, → / ← keys, and the reader's arrow
  //          keys (a `mio-reader-turn` message from the parent page).
  // Inside Mio's reader the page also reports where the reader is (`mio-reader-state`) and goes
  // back there after a live refresh (`mio-reader-restore`), so new images don't reset the page.
  var layout = document.body.getAttribute('data-layout');
  var embedded = window.parent !== window;
  var turners = [];
  var spreads = [];
  var paged = layout === 'manga' || layout === 'flip';
  Array.prototype.forEach.call(paged ? document.querySelectorAll('[data-cc-book]') : [], function (book) {
    var pages = book.querySelector('[data-cc-pages]');
    if (!pages) return;
    var frames = Array.prototype.slice.call(pages.querySelectorAll('[data-cc-frame]'));
    var realCount = frames.length;
    if (!realCount) return;
    if (frames.length % 2) {
      var blank = document.createElement('div');
      blank.className = 'cc-frame cc-blank';
      blank.setAttribute('data-cc-frame', '');
      blank.setAttribute('aria-label', '空白衬纸');
      blank.textContent = '留白';
      pages.appendChild(blank);
      frames.push(blank);
    }
    if (layout !== 'flip') return;
    var nav = document.createElement('nav');
    nav.className = 'cc-controls';
    nav.setAttribute('aria-label', '翻页控制');
    var prev = document.createElement('button');
    var next = document.createElement('button');
    var counter = document.createElement('span');
    prev.type = next.type = 'button';
    counter.setAttribute('aria-live', 'polite');
    nav.appendChild(prev);
    nav.appendChild(counter);
    nav.appendChild(next);
    pages.parentNode.insertBefore(nav, pages.nextSibling);
    var mobile = window.matchMedia ? window.matchMedia('(max-width:640px)') : null;
    var perPage = mobile && mobile.matches ? 1 : 2;
    var current = 0;
    function total() {
      return Math.ceil(realCount / perPage);
    }
    function each(selector, fn) {
      Array.prototype.forEach.call(book.querySelectorAll(selector), fn);
    }
    function show(animate) {
      // The cover and opening belong to the first spread, the colophon to the last.
      each('.edition-cover,.edition-opening,.edition-chapter,.cc-cover', function (el) {
        el.hidden = current > 0;
      });
      each('.edition-end', function (el) {
        el.hidden = current < total() - 1;
      });
      prev.textContent = perPage === 1 ? '上一幕' : '上一跨页';
      next.textContent = perPage === 1 ? '下一幕' : '下一跨页';
      frames.forEach(function (frame, i) {
        frame.hidden = Math.floor(i / perPage) !== current || (perPage === 1 && i >= realCount);
        frame.classList.remove('cc-turn');
      });
      counter.textContent = current + 1 + ' / ' + total();
      prev.disabled = current === 0;
      next.disabled = current >= total() - 1;
      if (!animate) return;
      window.scrollTo({ top: pages.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
      var right = frames[current * perPage + perPage - 1];
      if (right) {
        void right.offsetWidth;
        right.classList.add('cc-turn');
      }
    }
    function turn(step) {
      var to = Math.max(0, Math.min(total() - 1, current + step));
      if (to === current) return;
      current = to;
      show(true);
      report();
    }
    spreads.push({
      get: function () {
        return current;
      },
      set: function (to) {
        current = Math.max(0, Math.min(total() - 1, to));
        show(false);
      },
    });
    prev.onclick = function () {
      turn(-1);
    };
    next.onclick = function () {
      turn(1);
    };
    if (mobile) {
      var relayout = function () {
        var first = current * perPage;
        perPage = mobile.matches ? 1 : 2;
        current = Math.floor(first / perPage);
        show(false);
      };
      if (mobile.addEventListener) mobile.addEventListener('change', relayout);
      else if (mobile.addListener) mobile.addListener(relayout);
    }
    book.tabIndex = 0;
    book.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowRight') turn(1);
      else if (event.key === 'ArrowLeft') turn(-1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    });
    turners.push(turn);
    show(false);
  });
  // Arrow keys with nothing focused, and the reader around the preview, turn the first book.
  document.addEventListener('keydown', function (event) {
    if (!turners.length) return;
    if (event.target !== document.body && event.target !== document.documentElement) return;
    if (event.key === 'ArrowRight') turners[0](1);
    else if (event.key === 'ArrowLeft') turners[0](-1);
    else return;
    event.preventDefault();
  });
  var timer = 0;
  function report() {
    if (!embedded) return;
    clearTimeout(timer);
    timer = setTimeout(function () {
      window.parent.postMessage(
        { type: 'mio-reader-state', y: window.scrollY, spread: spreads.length ? spreads[0].get() : 0 },
        '*',
      );
    }, 120);
  }
  window.addEventListener('scroll', report, { passive: true });
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data) return;
    if (data.type === 'mio-reader-turn' && turners.length) turners[0](data.direction > 0 ? 1 : -1);
    if (data.type === 'mio-reader-restore') {
      if (spreads.length && data.spread > 0) spreads[0].set(data.spread);
      window.scrollTo({ top: Number(data.y) || 0, behavior: 'instant' });
    }
  });
})();
