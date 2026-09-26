/* Mio motion-comic player: camera moves per panel, crossfades, browser speech for the lines.
 * Reads the timeline from #mio-motion and options from #mio-motion-config (see motion/export.py).
 * Keys: Space play/pause, ← → previous/next, M voice, C subtitles, F fullscreen. */
(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('mio-motion').textContent);
  var config = JSON.parse(document.getElementById('mio-motion-config').textContent);
  var stage = document.getElementById('stage');
  var shots = data.shots || [];
  var synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  var state = {
    index: -1,
    playing: false,
    voice: !!(config.voice && synth),
    subtitles: !!config.subtitles,
    token: 0,
    flip: 0,
  };
  var timers = [];

  var ZOOM = 'scale(1.16)';
  var PAN = 'scale(1.18) ';
  var MOVES = {
    still: ['scale(1)', 'scale(1.02)'],
    push_in: ['scale(1)', ZOOM],
    pull_out: [ZOOM, 'scale(1)'],
    pan_left: [PAN + 'translateX(-6%)', PAN + 'translateX(6%)'],
    pan_right: [PAN + 'translateX(6%)', PAN + 'translateX(-6%)'],
    pan_up: [PAN + 'translateY(-6%)', PAN + 'translateY(6%)'],
    pan_down: [PAN + 'translateY(6%)', PAN + 'translateY(-6%)'],
  };
  var SHAKE = [
    [0, '0,0'],
    [0.03, '-1.6%,1%'],
    [0.06, '1.4%,-1.2%'],
    [0.09, '-1%,-0.6%'],
    [0.12, '0.8%,1%'],
    [0.16, '0,0'],
  ];

  function keyframes(move) {
    if (move === 'shake') {
      var frames = SHAKE.map(function (s) {
        return {
          transform: 'scale(1.06) translate(' + s[1] + ')',
          offset: s[0],
        };
      });
      frames.push({ transform: 'scale(1.1) translate(0,0)', offset: 1 });
      return frames;
    }
    var m = MOVES[move] || MOVES.still;
    return [{ transform: m[0] }, { transform: m[1] }];
  }

  function el(tag, cls, parent) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (parent) parent.appendChild(node);
    return node;
  }

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  // ------------------------------------------------------------------ layers
  var layers = [0, 1].map(function () {
    var layer = el('div', 'layer', stage);
    var backdrop = el('div', 'backdrop', layer);
    var camera = el('div', 'camera', layer);
    var img = el('img', '', camera);
    img.alt = '';
    return {
      root: layer,
      backdrop: backdrop,
      camera: camera,
      img: img,
      anim: null,
    };
  });
  var subtitle = el('div', 'subtitle', stage);

  function setSubtitle(line) {
    subtitle.textContent = '';
    if (!line || !state.subtitles) return;
    if (line.speaker) el('b', '', subtitle).textContent = line.speaker;
    subtitle.appendChild(document.createTextNode(line.text));
  }

  // ------------------------------------------------------------------- voice
  var FEMALE = new RegExp(
    'female|woman|女|xiaoxiao|xiaoyi|xiaohan|xiaomeng|huihui|yaoyao|tingting|meijia|' +
      'sinji|hanhan|kyoko|nanami|samantha|zira|aria|jenny',
    'i',
  );
  var MALE = new RegExp(
    '\\bmale\\b|man\\b|男|yunxi|yunyang|yunjian|yunze|kangkang|zhiwei|keita|' +
      'daniel|david|guy|alex',
    'i',
  );

  function voicesFor(lang) {
    if (!synth) return [];
    var prefix = lang.split('-')[0].toLowerCase();
    return synth.getVoices().filter(function (v) {
      return (v.lang || '').toLowerCase().indexOf(prefix) === 0;
    });
  }

  function hash(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function pickVoice(voice) {
    var all = voicesFor(config.lang || 'zh-CN');
    if (!all.length) return null;
    var pool = all.filter(function (v) {
      var female = FEMALE.test(v.name);
      if (voice.gender === 'female') return female;
      if (voice.gender === 'male') return !female && MALE.test(v.name);
      return true;
    });
    if (!pool.length) pool = all;
    return voice.id === 'narrator' ? pool[0] : pool[hash(voice.id) % pool.length];
  }

  function readingMs(text) {
    var cjk = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
    return (cjk / 6 + (text.length - cjk) / 15) * 1000;
  }

  /** Speak the lines one after another; `done` runs once (also if speech stalls or fails). */
  function speak(lines, token, done) {
    var k = 0;
    function step() {
      if (token !== state.token) return;
      if (k >= lines.length) {
        setSubtitle(null);
        done();
        return;
      }
      var line = lines[k++];
      setSubtitle(line);
      var finished = false;
      function next() {
        if (finished || token !== state.token) return;
        finished = true;
        later(step, 250);
      }
      var u = new SpeechSynthesisUtterance(line.text);
      u.lang = config.lang || 'zh-CN';
      u.pitch = Math.max(0.1, Math.min(2, line.voice.pitch || 1));
      u.rate = Math.max(0.5, Math.min(2, line.voice.rate || 1));
      var v = pickVoice(line.voice);
      if (v) u.voice = v;
      u.onend = next;
      u.onerror = next;
      synth.speak(u);
      // Some engines never fire onend for long lines: fall back to twice the reading time.
      later(next, readingMs(line.text) * 2 + 3000);
    }
    step();
  }

  /** Without voice: show each line for a share of the hold proportional to its length. */
  function captionsOnly(lines, holdMs, token) {
    var total = lines.reduce(function (n, l) {
      return n + l.text.length;
    }, 0);
    var at = 0;
    lines.forEach(function (line) {
      later(function () {
        if (token === state.token) setSubtitle(line);
      }, at);
      at += (holdMs * line.text.length) / (total || 1);
    });
  }

  // ------------------------------------------------------------------ control
  function show(i) {
    if (synth) synth.cancel();
    clearTimers();
    state.token += 1;
    state.index = i;
    hideCard();
    renderBar();
    var shot = shots[i];
    var layer = layers[state.flip];
    var other = layers[1 - state.flip];
    state.flip = 1 - state.flip;
    layer.backdrop.style.backgroundImage = 'url("' + shot.image + '")';
    layer.img.src = shot.image;
    if (layer.anim) layer.anim.cancel();
    var holdMs = Math.max(500, shot.hold * 1000);
    if (layer.camera.animate) {
      layer.anim = layer.camera.animate(keyframes(shot.move), {
        duration: holdMs * 1.15,
        easing: shot.move.indexOf('pan') === 0 ? 'ease-in-out' : 'ease-out',
        fill: 'forwards',
      });
      if (!state.playing) layer.anim.pause();
    }
    layer.root.classList.add('on');
    other.root.classList.remove('on');
    setSubtitle(null);
    if (state.playing) run(shot, holdMs, state.token);
  }

  function run(shot, holdMs, token) {
    var minDone = false;
    var spoken = !(state.voice && shot.lines.length);
    function maybeNext() {
      if (token !== state.token || !minDone || !spoken) return;
      later(next, 350);
    }
    later(function () {
      minDone = true;
      maybeNext();
    }, holdMs);
    if (!spoken) {
      speak(shot.lines, token, function () {
        spoken = true;
        maybeNext();
      });
    } else {
      captionsOnly(shot.lines, holdMs, token);
    }
  }

  function next() {
    if (state.index + 1 < shots.length) show(state.index + 1);
    else finish();
  }

  function prev() {
    show(Math.max(0, state.index - 1));
  }

  function play() {
    if (!shots.length) return;
    state.playing = true;
    show(state.index < 0 || state.index >= shots.length ? 0 : state.index);
  }

  function pause() {
    state.playing = false;
    state.token += 1;
    clearTimers();
    if (synth) synth.cancel();
    layers.forEach(function (l) {
      if (l.anim) l.anim.pause();
    });
    renderBar();
  }

  function toggle() {
    if (state.playing) pause();
    else play();
  }

  // --------------------------------------------------------------- cards/bar
  var card = null;

  function showCard(heading, sub, text, label) {
    hideCard();
    card = el('section', 'card', stage);
    if (sub) el('div', 'series', card).textContent = sub;
    el('h1', '', card).textContent = heading;
    if (text) el('p', '', card).textContent = text;
    if (label) {
      var button = el('button', '', card);
      button.textContent = label;
      button.addEventListener('click', function (e) {
        e.stopPropagation();
        state.index = -1;
        play();
      });
    }
  }

  function hideCard() {
    if (card) card.remove();
    card = null;
  }

  function finish() {
    state.playing = false;
    renderBar();
    showCard('完', data.series, data.title, '↺ 重播');
  }

  var bar = el('nav', 'bar', stage);
  var buttons = {};
  [
    ['prev', '⏮', prev],
    ['play', '▶', toggle],
    ['next', '⏭', next],
  ].forEach(function (b) {
    buttons[b[0]] = el('button', '', bar);
    buttons[b[0]].textContent = b[1];
    buttons[b[0]].addEventListener('click', b[2]);
  });
  var dots = el('div', 'dots', bar);
  var count = el('span', 'count', bar);
  buttons.voice = el('button', '', bar);
  buttons.voice.textContent = '🔊';
  buttons.voice.title = synth ? '配音 (M)' : '此浏览器不支持语音合成';
  buttons.voice.disabled = !synth;
  buttons.voice.addEventListener('click', function () {
    state.voice = !state.voice;
    renderBar();
    if (state.playing) show(state.index);
  });
  buttons.cc = el('button', '', bar);
  buttons.cc.textContent = 'CC';
  buttons.cc.title = '字幕 (C)';
  buttons.cc.addEventListener('click', function () {
    state.subtitles = !state.subtitles;
    if (!state.subtitles) setSubtitle(null);
    renderBar();
  });
  buttons.full = el('button', '', bar);
  buttons.full.textContent = '⛶';
  buttons.full.title = '全屏 (F)';
  buttons.full.addEventListener('click', fullscreen);

  shots.forEach(function (_, i) {
    var dot = el('i', '', dots);
    dot.addEventListener('click', function () {
      show(i);
    });
  });

  function renderBar() {
    buttons.play.textContent = state.playing ? '⏸' : '▶';
    buttons.voice.setAttribute('aria-pressed', String(state.voice));
    buttons.cc.setAttribute('aria-pressed', String(state.subtitles));
    Array.prototype.forEach.call(dots.children, function (dot, i) {
      dot.className = i === state.index ? 'now' : i < state.index ? 'done' : '';
    });
    count.textContent = Math.max(0, state.index + 1) + ' / ' + shots.length;
  }

  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen)
      document.documentElement.requestFullscreen();
  }

  // ------------------------------------------------------------------ inputs
  var idle = 0;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idle);
    idle = setTimeout(function () {
      if (state.playing) document.body.classList.add('idle');
    }, 2500);
  }
  document.addEventListener('mousemove', wake);
  document.addEventListener('touchstart', wake, { passive: true });
  document.addEventListener('keydown', function (e) {
    var key = e.key.toLowerCase();
    if (key === ' ' || key === 'k') toggle();
    else if (key === 'arrowright') next();
    else if (key === 'arrowleft') prev();
    else if (key === 'm') buttons.voice.click();
    else if (key === 'c') buttons.cc.click();
    else if (key === 'f') fullscreen();
    else return;
    e.preventDefault();
    wake();
  });
  if (synth && synth.onvoiceschanged !== undefined) synth.onvoiceschanged = function () {};

  renderBar();
  if (shots.length) showCard(data.title, data.series, data.synopsis, '▶ 播放');
  else showCard('没有可播放的画面', data.series, '先在分镜板采用每一格的图片。', '');

  window.mioMotion = {
    state: state,
    show: show,
    play: play,
    pause: pause,
    keyframes: keyframes,
  };
})();
