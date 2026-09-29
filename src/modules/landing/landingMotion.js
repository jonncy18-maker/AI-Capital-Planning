// Scroll choreography for the landing page. Everything is driven by scroll position and written
// straight to the DOM (CSS variables, transforms, SVG), so scrolling never triggers a React render.
export function initLanding(lp) {
  const q = (s) => lp.querySelector(s)
  const qa = (s) => Array.prototype.slice.call(lp.querySelectorAll(s))
  const byId = (id) => lp.querySelector('#' + id)
  const cleanups = []
  const on = (target, evt, fn, opts) => {
    target.addEventListener(evt, fn, opts)
    cleanups.push(() => target.removeEventListener(evt, fn, opts))
  }
  const onReady = (fn) => {
    if (document.readyState === 'complete') fn()
    else on(window, 'load', fn)
  }
  const docEl = document.documentElement
  const api = {}
  let alive = true

  var MONO = "DM Mono, ui-monospace, monospace";
  function txt(x, y, s, anchor) { return '<text x="' + x + '" y="' + y + '" text-anchor="' + (anchor || 'middle') + '" font-size="10.5" font-family="' + MONO + '" fill="var(--tx-3)">' + s + '</text>'; }
  var MONTHS = ['J','F','M','A','M','J','J','A','S','O','N','D'];

  // Hero chart: bars and line share one scale; the forecast layer redraws as the scroll story advances.
  (function () {
    var budget = [5200,5200,5400,5200,5300,5200,5600,5200,5300,5400,5200,5900];
    var base   = [5050,5320,6380,5100,5240,5390,5480,5260,5210,5520,6700,5750];
    var moved  = [5050,5320,6900,5100,5240,5390,5480,5260,5210,5520,5450,5750];
    var W = 560, H = 190, L = 40, R = 6, T = 8, B = 22, min = 4000, max = 7000;
    var y = function (v) { return T + (H - T - B) * (1 - (v - min) / (max - min)); };
    var bw = (W - L - R) / 12, x = function (i) { return L + bw * i + bw / 2; };
    var s = '';
    [4000, 5000, 6000, 7000].forEach(function (t) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="var(--bd)" stroke-dasharray="' + (t === 4000 ? '0' : '2 4') + '"/>';
      s += txt(L - 8, y(t) + 4, '$' + t / 1000 + 'k', 'end');
    });
    budget.forEach(function (v, i) {
      s += '<rect x="' + (x(i) - bw * .3) + '" y="' + y(v) + '" width="' + bw * .6 + '" height="' + (y(min) - y(v)) + '" rx="3" fill="var(--bar)"/>';
      s += txt(x(i), H - 6, MONTHS[i]);
    });
    var svg = byId('heroChart');
    svg.innerHTML = s + '<defs><linearGradient id="scan" x1="0" x2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".28"/></linearGradient></defs><g id="hcDyn"></g>';
    var dyn = byId('hcDyn'), lastKey = '';
    api.setHeroChart = function (sw) {
      var key = sw.toFixed(3); if (key === lastKey) return; lastKey = key;
      var n = 12, pos = sw * (n + 3);
      var f = base.map(function (v, i) { var b = Math.max(0, Math.min(1, (pos - i) / 3)); b = b * b * (3 - 2 * b); return v + (moved[i] - v) * b; });
      var pts = f.map(function (v, i) { return x(i) + ',' + y(v); }).join(' ');
      var g = '<polygon points="' + x(0) + ',' + y(min) + ' ' + pts + ' ' + x(11) + ',' + y(min) + '" fill="var(--fc-fill)"/>';
      g += '<polyline points="' + pts + '" fill="none" stroke="var(--d-scn)" stroke-width="2.2" stroke-linejoin="round"/>';
      f.forEach(function (v, i) {
        if (v > budget[i] * 1.08) g += '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="5" fill="var(--warn)" stroke="var(--card-2)" stroke-width="2"/>';
      });
      if (sw > 0.001 && sw < 0.999) {
        var sx = L + (W - L - R) * sw;
        g += '<rect x="' + (sx - 26) + '" y="' + T + '" width="26" height="' + (H - T - B) + '" fill="url(#scan)"/><line x1="' + sx + '" x2="' + sx + '" y1="' + T + '" y2="' + (H - B) + '" stroke="var(--accent)" stroke-width="1.5"/>';
      }
      dyn.innerHTML = g;
    };
    api.setHeroChart(0);
  })();

  // Scenario demo: month-end balance (thousands) per scenario, animated between states.
  (function () {
    var S = [
      [6.2,6.8,7.07,7.6,8.0,8.4,8.9,9.3,9.6,8.8,4.86,5.4],
      [6.2,6.8,2.87,3.4,3.8,4.2,4.7,5.1,5.4,4.6,4.9,5.4],
      [6.2,6.8,4.17,3.4,3.8,4.2,4.7,5.1,5.4,4.6,4.9,5.4]
    ];
    var FLOOR = 3, W = 600, H = 260, L = 40, R = 10, T = 12, B = 26, min = 0, max = 10;
    var y = function (v) { return T + (H - T - B) * (1 - (v - min) / (max - min)); };
    var step = (W - L - R) / 11, x = function (i) { return L + step * i; };
    var svg = byId('demoChart');
    var grid = '';
    [0, 2.5, 5, 7.5, 10].forEach(function (t) {
      grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="var(--bd)" stroke-dasharray="' + (t === 0 ? '0' : '2 4') + '"/>';
      grid += txt(L - 8, y(t) + 4, '$' + t + 'k', 'end');
    });
    MONTHS.forEach(function (m, i) { grid += txt(x(i), H - 8, m); });
    grid += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(FLOOR) + '" y2="' + y(FLOOR) + '" stroke="var(--bad)" stroke-opacity=".7" stroke-dasharray="6 4"/>';
    grid += '<text x="' + (W - R) + '" y="' + (y(FLOOR) - 6) + '" text-anchor="end" font-size="10.5" font-family="' + MONO + '" fill="var(--bad)">$3k FLOOR</text>';
    svg.innerHTML = grid + '<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>' +
      '<path id="area" fill="url(#ag)"/><path id="line" fill="none" stroke="var(--accent)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/><g id="marks"></g>';
    var area = byId('area'), line = byId('line'), marks = byId('marks');
    var lowEl = byId('low'), st = byId('status');
    function smooth(v) {
      var p = v.map(function (d, i) { return [x(i), y(d)]; }), d = 'M' + p[0][0] + ',' + p[0][1];
      for (var i = 1; i < p.length; i++) { var mx = (p[i - 1][0] + p[i][0]) / 2; d += ' C' + mx + ',' + p[i - 1][1] + ' ' + mx + ',' + p[i][1] + ' ' + p[i][0] + ',' + p[i][1]; }
      return d;
    }
    function render(v) {
      var d = smooth(v);
      line.setAttribute('d', d);
      area.setAttribute('d', d + ' L' + x(11) + ',' + y(0) + ' L' + x(0) + ',' + y(0) + 'Z');
      var lo = 0; v.forEach(function (d, i) { if (d < v[lo]) lo = i; });
      var c = v[lo] < FLOOR ? 'var(--bad)' : 'var(--accent)';
      marks.innerHTML = '<circle cx="' + x(lo) + '" cy="' + y(v[lo]) + '" r="10" fill="' + c + '" fill-opacity=".18"/><circle cx="' + x(lo) + '" cy="' + y(v[lo]) + '" r="5" fill="' + c + '" stroke="var(--card)" stroke-width="2"/>';
      return lo;
    }
    function settle(target) {
      var lo = 0; target.forEach(function (d, i) { if (d < target[lo]) lo = i; });
      var v = target[lo];
      lowEl.textContent = '$' + Math.round(v * 1000).toLocaleString('en-US');
      var ok = v >= FLOOR;
      st.className = 'lp-status ' + (ok ? 'lp-ok' : 'lp-no');
      st.textContent = ok ? 'Clears $3,000 floor' : 'Below floor in ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][lo];
    }
    render(S[0]); settle(S[0]);
    // The section pins while scrolling; scroll position picks the scenario and blends between them.
    var spin = byId('spin'), inner = spin.firstElementChild, opts = Array.prototype.slice.call(qa('.lp-opt'));
    var active = 0, forced = false, ticking = false, reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cl = function (v) { return Math.max(0, Math.min(1, v)); }, sm = function (v) { return v * v * (3 - 2 * v); };
    function isPinned() { return window.matchMedia('(min-width: 900px)').matches && !spin.classList.contains('lp-static'); }
    function apply(u) {
      var k = Math.min(1, Math.floor(u)), f = u - k, w = sm(cl((f - 0.5) / 0.4));
      var v = S[k].map(function (a, i) { return a + (S[k + 1][i] - a) * w; });
      render(v); settle(v);
      var idx = w > 0.5 ? k + 1 : k;
      if (idx !== active) { active = idx; opts.forEach(function (o, i) { o.setAttribute('aria-pressed', String(i === idx)); }); }
    }
    function update() {
      ticking = false;
      if (!alive || forced) return;
      var r = spin.getBoundingClientRect(), vh = window.innerHeight || 800;
      var p = isPinned() ? cl(-(r.top - 80) / Math.max(1, r.height - inner.offsetHeight - 80)) : cl((vh * 0.85 - r.top) / (vh * 0.35 + r.height * 0.6));
      apply(p * 2);
    }
    function req() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    on(window, 'scroll', function () { forced = false; req(); }, { passive: true });
    on(window, 'resize', req);
    // Clicking an option scrolls to that scenario's spot so scroll and selection never disagree.
    opts.forEach(function (b, i) {
      on(b, 'click', function () {
        if (isPinned()) {
          var r = spin.getBoundingClientRect(), y = window.scrollY + r.top - 80 + (i / 2) * (r.height - inner.offsetHeight - 80);
          window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
        } else { forced = true; apply(i); }
      });
    });
    onReady(function () {
      if (docEl.scrollHeight <= (window.innerHeight || 800) + 40) spin.classList.add('lp-static');
      req();
    });
    update();
  })();

  // One scroll engine: everything below is driven by scroll position, nothing free-runs.
  (function () {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var vid = byId('vid'), pin = byId('pin'), hint = byId('hint');
    var mods = q('.lp-mods'), track = q('.lp-marquee .lp-track'), prog = q('.lp-vprog');
    var dur = 0, half = 0, ticking = false, lastT = -1;
    var hpin = byId('hpin'), hw = hpin.firstElementChild, calc = byId('calc'), rows = calc.querySelectorAll('.lp-cr'), k1 = byId('k1'), k2 = byId('k2'), k2d = byId('k2d'), k4 = byId('k4'), k4d = byId('k4d'), ck = byId('cmdK');
    var lerp = function (a, b, t) { return a + (b - a) * t; };
    // Scroll story: the AI moves the trip to March; forecast, low point and next hit update.
    function story(sp, pinned) {
      var sm = function (x) { return x * x * (3 - 2 * x); };
      var up = sm(clamp(sp / 0.24)), down = sm(clamp((sp - 0.72) / 0.24));
      var ex = pinned ? up * (1 - down) : 0;
      var sweep = clamp((sp - 0.24) / 0.42), e = ease(sweep);
      var co = clamp((sp - 0.22) / 0.05) * (1 - clamp((sp - 0.7) / 0.06));
      hw.style.setProperty('--ex', ex.toFixed(3));
      calc.style.setProperty('--co', co.toFixed(3));
      for (var i = 0; i < rows.length; i++) rows[i].style.setProperty('--ro', clamp(sweep * 4.4 - i * 0.9).toFixed(3));
      api.setHeroChart(sweep);
      k1.textContent = '$' + Math.round(lerp(4860, 3180, e)).toLocaleString('en-US');
      k2.textContent = lerp(5.2, 4.6, e).toFixed(1) + ' mo';
      var moved = e > 0.5;
      k2d.textContent = moved ? '▼ 0.6' : '▲ 0.4'; k2d.className = 'lp-d ' + (moved ? 'lp-wn' : 'lp-up');
      k4.textContent = moved ? 'Mar 09' : 'Mar 14';
      k4d.textContent = moved ? '$4,200 trip' : '$1,300 insurance';
      var done = sp > 0.92; ck.textContent = done ? 'Draft ready' : '⌘K'; ck.className = 'lp-k' + (done ? ' lp-done' : '');
    }
    var clamp = function (x) { return Math.max(0, Math.min(1, x)); };
    var ease = function (x) { return 1 - Math.pow(1 - x, 3); };
    on(vid, 'loadedmetadata', function () { dur = vid.duration || 0; update(); });
    function measure() { half = track.scrollWidth / 2; }
    function update() {
      ticking = false;
      if (!alive) return;
      var y = window.scrollY || docEl.scrollTop || 0, vh = window.innerHeight || 800;
      lp.style.setProperty('--sweep', clamp(y / 2600).toFixed(3));
      lp.style.setProperty('--hp', ease(clamp(y / 420)).toFixed(3));
      var hr = hpin.getBoundingClientRect(), pinned = window.matchMedia('(min-width: 900px)').matches && !hpin.classList.contains('lp-flow');
      var sp = pinned ? clamp(-(hr.top - 76) / Math.max(1, hr.height - hw.offsetHeight - 76)) : clamp((vh * 0.6 - hw.getBoundingClientRect().top) / (vh * 0.4));
      sp = clamp((sp - 0.26) / 0.74);
      if (reduce) sp = 0;
      story(sp, pinned);
      if (half) track.style.transform = 'translateX(' + (-((y * 0.6) % half)).toFixed(1) + 'px)';
      if (!pin.classList.contains('lp-static')) {
        var r = pin.getBoundingClientRect(), stick = pin.firstElementChild.offsetHeight + 72;
        var p = clamp(-(r.top - 72) / Math.max(1, r.height - stick));
        if (prog) lp.style.setProperty('--vp', p.toFixed(3));
        if (dur) { var t = p * (dur - 0.05); if (Math.abs(t - lastT) > 0.03) { lastT = t; vid.currentTime = t; } }
        hint.textContent = p <= 0.01 ? 'SCROLL TO PLAY' : p >= 0.99 ? 'SCROLL ON' : Math.round(p * 100) + '%';
      }
      var m = mods.getBoundingClientRect();
      mods.style.setProperty('--p', reduce ? 1 : ease(clamp((vh * 0.9 - m.top) / (vh * 0.6))).toFixed(3));
    }
    function req() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    on(window, 'scroll', req, { passive: true });
    on(window, 'resize', function () { measure(); req(); });
    onReady(function () {
      measure();
      // If the page can't scroll on its own (embedded at full height), play the clip as a loop instead.
      if (docEl.scrollHeight <= (window.innerHeight || 800) + 40) hpin.classList.add('lp-flow');
      if (reduce || docEl.scrollHeight <= (window.innerHeight || 800) + 40) {
        pin.classList.add('lp-static'); hint.textContent = 'PREVIEW';
        if (!reduce) { vid.loop = true; vid.play().catch(function () {}); }
      }
      update();
    });
    measure(); update();
  })();

  return () => {
    alive = false
    cleanups.forEach((fn) => fn())
  }
}
