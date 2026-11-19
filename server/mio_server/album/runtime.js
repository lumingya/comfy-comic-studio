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
  var lightbox = null;
  var closeLightbox = null;
  var moveLightbox = null;
  var reducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
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
    if (lightbox && !lightbox.hidden) {
      if (event.key === 'Escape' && closeLightbox) closeLightbox();
      else if (event.key === 'ArrowRight' && moveLightbox) moveLightbox(1);
      else if (event.key === 'ArrowLeft' && moveLightbox) moveLightbox(-1);
      else if (event.key === 'Tab') trapLightboxFocus(event);
      else return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!turners.length) return;
    if (event.target !== document.body && event.target !== document.documentElement) return;
    if (event.key === 'ArrowRight') turners[0](1);
    else if (event.key === 'ArrowLeft') turners[0](-1);
    else return;
    event.preventDefault();
  });
  var lightboxImages = [];
  var lightboxIndex = -1;
  var lightboxReturnFocus = null;
  var lightboxPreviousOverflow = '';
  var lightboxPreviousTabindex = null;
  Array.prototype.forEach.call(document.querySelectorAll('[data-cc-frame] img'), function (image) {
    if (image.closest('.cc-blank') || !image.getAttribute('src')) return;
    image.setAttribute('tabindex', image.getAttribute('tabindex') || '0');
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', '打开画作预览：' + (image.alt || '画作'));
    lightboxImages.push(image);
  });
  if (lightboxImages.length) {
    lightbox = document.createElement('div');
    lightbox.className = 'cc-lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', '画作预览');
    lightbox.hidden = true;
    lightbox.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;align-items:center;justify-content:center;'
      + 'gap:16px;padding:24px;background:rgba(10,12,14,.94);color:#fff;';
    var lightboxClose = document.createElement('button');
    lightboxClose.type = 'button';
    lightboxClose.className = 'cc-lightbox-close';
    lightboxClose.setAttribute('aria-label', '关闭画作预览');
    lightboxClose.textContent = '×';
    lightboxClose.style.cssText = 'position:absolute;top:16px;right:20px;font-size:32px;';
    var lightboxPrevious = document.createElement('button');
    lightboxPrevious.type = 'button';
    lightboxPrevious.className = 'cc-lightbox-previous';
    lightboxPrevious.setAttribute('aria-label', '上一幅画作');
    lightboxPrevious.textContent = '‹';
    var lightboxNext = document.createElement('button');
    lightboxNext.type = 'button';
    lightboxNext.className = 'cc-lightbox-next';
    lightboxNext.setAttribute('aria-label', '下一幅画作');
    lightboxNext.textContent = '›';
    var lightboxFigure = document.createElement('figure');
    lightboxFigure.style.cssText =
      'display:flex;flex-direction:column;align-items:center;justify-content:center;max-width:85vw;'
      + 'max-height:90vh;margin:0;';
    var lightboxImage = document.createElement('img');
    lightboxImage.alt = '';
    lightboxImage.style.cssText = 'max-width:100%;max-height:82vh;object-fit:contain;';
    var lightboxCaption = document.createElement('figcaption');
    lightboxCaption.className = 'cc-lightbox-caption';
    lightboxCaption.style.cssText = 'margin-top:10px;text-align:center;';
    lightboxFigure.appendChild(lightboxImage);
    lightboxFigure.appendChild(lightboxCaption);
    lightbox.appendChild(lightboxClose);
    lightbox.appendChild(lightboxPrevious);
    lightbox.appendChild(lightboxFigure);
    lightbox.appendChild(lightboxNext);
    document.body.appendChild(lightbox);
    lightboxClose.onclick = function () { if (closeLightbox) closeLightbox(); };
    lightboxPrevious.onclick = function () { moveLightbox(-1); };
    lightboxNext.onclick = function () { moveLightbox(1); };
    lightbox.onclick = function (event) {
      if (event.target === lightbox) closeLightbox();
    };
    document.addEventListener('click', function (event) {
      var target = event.target;
      var image = target && target.closest ? target.closest('[data-cc-frame] img') : null;
      if (!image || !image.getAttribute('src')) return;
      var index = lightboxImages.indexOf(image);
      if (index < 0) return;
      event.preventDefault();
      openLightbox(index, image);
    });
    document.addEventListener('keydown', function (event) {
      var target = event.target;
      if (!target || !target.matches || !target.matches('[data-cc-frame] img[role="button"]')) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var index = lightboxImages.indexOf(target);
      if (index < 0) return;
      event.preventDefault();
      openLightbox(index, target);
    });
    function renderLightbox() {
      var source = lightboxImages[lightboxIndex];
      if (!source) return;
      lightboxImage.src = source.currentSrc || source.src;
      lightboxImage.alt = source.alt || '画作';
      var frame = source.closest('[data-cc-frame]');
      var caption = frame && frame.querySelector('[data-cc-caption]');
      lightboxCaption.textContent = caption ? caption.textContent.trim() : '';
      lightboxPrevious.disabled = lightboxIndex <= 0;
      lightboxNext.disabled = lightboxIndex >= lightboxImages.length - 1;
      lightbox.setAttribute('aria-label', lightboxImage.alt + '，' + (lightboxIndex + 1) + ' / ' + lightboxImages.length);
    }
    function openLightbox(index, image) {
      lightboxIndex = index;
      lightboxReturnFocus = image;
      lightboxPreviousTabindex = image.getAttribute('tabindex');
      if (lightboxPreviousTabindex === null) image.setAttribute('tabindex', '-1');
      lightboxPreviousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      renderLightbox();
      lightbox.hidden = false;
      lightbox.style.display = 'flex';
      lightbox.style.transition = reducedMotion ? 'none' : 'opacity 160ms ease';
      lightbox.style.opacity = '1';
      lightboxClose.focus();
    }
    moveLightbox = function (step) {
      var next = Math.max(0, Math.min(lightboxImages.length - 1, lightboxIndex + step));
      if (next === lightboxIndex) return;
      lightboxIndex = next;
      renderLightbox();
    };
    closeLightbox = function () {
      if (!lightbox || lightbox.hidden) return;
      lightbox.hidden = true;
      lightbox.style.display = 'none';
      document.body.style.overflow = lightboxPreviousOverflow;
      if (lightboxReturnFocus) {
        if (lightboxPreviousTabindex === null) lightboxReturnFocus.removeAttribute('tabindex');
        else lightboxReturnFocus.setAttribute('tabindex', lightboxPreviousTabindex);
        lightboxReturnFocus.focus();
      }
      lightboxReturnFocus = null;
    };
    function trapLightboxFocus(event) {
      var controls = [lightboxClose, lightboxPrevious, lightboxNext].filter(function (button) {
        return !button.disabled;
      });
      var first = controls[0];
      var last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus();
      }
    }
  }
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
