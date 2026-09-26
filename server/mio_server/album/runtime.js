(function () {
  // Mio album reader: two-page spreads for manga / flip layouts; everything else scrolls.
  var layout = document.body.getAttribute('data-layout');
  if (layout !== 'manga' && layout !== 'flip') return;
  var rtl = layout === 'manga';
  var readers = [];
  var books = document.querySelectorAll('[data-cc-book]');
  Array.prototype.forEach.call(books, function (book) {
    var pages = book.querySelector('[data-cc-pages]');
    if (!pages) return;
    var frames = Array.prototype.slice.call(pages.querySelectorAll('[data-cc-frame]'));
    if (!frames.length) return;
    if (frames.length % 2) {
      var blank = document.createElement('div');
      blank.className = 'cc-frame cc-blank';
      blank.setAttribute('data-cc-frame', '');
      blank.setAttribute('aria-label', '空白页');
      pages.appendChild(blank);
      frames.push(blank);
    }
    var total = frames.length / 2;
    var spread = 0;
    var bar = document.createElement('nav');
    bar.className = 'cc-controls';
    var prev = document.createElement('button');
    var next = document.createElement('button');
    var count = document.createElement('span');
    prev.type = next.type = 'button';
    prev.textContent = rtl ? '›' : '‹';
    next.textContent = rtl ? '‹' : '›';
    prev.setAttribute('aria-label', '上一页');
    next.setAttribute('aria-label', '下一页');
    if (rtl) bar.append(next, count, prev);
    else bar.append(prev, count, next);
    pages.parentNode.insertBefore(bar, pages.nextSibling);
    function show() {
      frames.forEach(function (frame, i) {
        frame.hidden = Math.floor(i / 2) !== spread;
      });
      count.textContent = spread + 1 + ' / ' + total;
      prev.disabled = spread === 0;
      next.disabled = spread === total - 1;
    }
    function go(step) {
      spread = Math.max(0, Math.min(total - 1, spread + step));
      show();
    }
    prev.onclick = function () {
      go(-1);
    };
    next.onclick = function () {
      go(1);
    };
    readers.push(go);
    show();
  });
  document.addEventListener('keydown', function (event) {
    if (!readers.length) return;
    var forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    var back = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward) readers[0](1);
    if (event.key === back) readers[0](-1);
  });
})();
