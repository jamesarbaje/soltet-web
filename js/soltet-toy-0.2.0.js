/* soltet-toy v0.2.0 — playable mini-Soltet for the soltet.com hero.
 * Balls fall and bounce off shapes; every collision plays a pentatonic note.
 * Click or tap to drop more balls. Sound is off until the visitor turns it on.
 *
 * Usage: put data-soltet-toy on a positioned container (the hero section) and
 * load this file. Optionally place a <button data-soltet-toy-sound> inside it to
 * style and position the sound toggle yourself. Matter.js is fetched from jsDelivr if it is not on the page.
 * Without JS, or if Matter fails to load, the hero simply shows no toy. */
(function () {
  "use strict";
  if (window.SoltetToy) return; // double-init guard
  var VERSION = "0.2.0";
  var MATTER_URL = "https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js";
  var MATTER_SRI = "sha384-ZRKYEXtLBVeqs9z1WxyeKutCqnkqolS/r1EUWuoUpG4ZKbnRAIXnHhHdnNuiB6CL";
  var STORE_KEY = "soltetToySound";

  // Look taken from the game: white shapes with a dark round core and a faint
  // halo; dark balls marked with a white X; a warm glow when a shape is hit.
  var WHITE = "#ffffff", CORE = "#17151a", CORE_HIT = "#6b2a2a", BALL = "#17151a", MINT = "#c9f0dc";
  var HALO = "rgba(17,17,17,0.26)", GLOW = "rgba(255,176,140,0.95)";
  // C major pentatonic, two octaves (semitones above C4).
  var SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
  var MAX_BALLS = 36, AUTO_BALLS = 12, STEP = 1000 / 60;

  // Shape layouts in container-relative units. n = index into SCALE.
  var WIDE = [
    { t: "circle", x: 0.10, y: 0.25, r: 0.040, n: 5 },
    { t: "circle", x: 0.20, y: 0.40, r: 0.034, n: 7 },
    { t: "circle", x: 0.09, y: 0.56, r: 0.046, n: 2 },
    { t: "tri", x: 0.22, y: 0.71, r: 0.052, n: 4 },
    { t: "circle", x: 0.11, y: 0.87, r: 0.036, n: 6 },
    { t: "circle", x: 0.31, y: 0.90, r: 0.030, n: 9 },
    { t: "circle", x: 0.90, y: 0.24, r: 0.036, n: 6 },
    { t: "circle", x: 0.79, y: 0.38, r: 0.044, n: 3 },
    { t: "tri", x: 0.91, y: 0.55, r: 0.050, n: 1 },
    { t: "circle", x: 0.77, y: 0.69, r: 0.034, n: 8 },
    { t: "circle", x: 0.89, y: 0.85, r: 0.042, n: 0 },
    { t: "circle", x: 0.68, y: 0.91, r: 0.030, n: 7 },
    { t: "circle", x: 0.50, y: 0.94, r: 0.032, n: 4 }
  ];
  var NARROW = [
    { t: "circle", x: 0.20, y: 0.63, r: 0.085, n: 2 },
    { t: "circle", x: 0.79, y: 0.67, r: 0.075, n: 4 },
    { t: "tri", x: 0.50, y: 0.75, r: 0.095, n: 0 },
    { t: "circle", x: 0.16, y: 0.85, r: 0.070, n: 5 },
    { t: "circle", x: 0.85, y: 0.87, r: 0.080, n: 3 },
    { t: "circle", x: 0.50, y: 0.94, r: 0.062, n: 7 }
  ];

  function loadMatter(done) {
    if (window.Matter) return done();
    var s = document.createElement("script");
    s.src = MATTER_URL; s.integrity = MATTER_SRI; s.crossOrigin = "anonymous";
    s.onload = done;
    document.head.appendChild(s);
  }

  function readPref() { try { return localStorage.getItem(STORE_KEY) === "1"; } catch (e) { return false; } }
  function writePref(on) { try { localStorage.setItem(STORE_KEY, on ? "1" : "0"); } catch (e) {} }

  // ---- Sound: raw Web Audio, created only after a user gesture -------------
  function Sound() {
    this.on = readPref();
    this.ctx = null;
  }
  Sound.prototype.unlock = function () {
    if (!this.on) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      var c = this.ctx = new AC();
      this.out = c.createGain(); this.out.gain.value = 0.5;
      var comp = c.createDynamicsCompressor();
      this.out.connect(comp); comp.connect(c.destination);
      // A soft echo so notes ring out a little, like the in-game delay.
      var delay = c.createDelay(1); delay.delayTime.value = 0.26;
      var fb = c.createGain(); fb.gain.value = 0.28;
      var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
      this.send = c.createGain(); this.send.gain.value = 0.35;
      this.send.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(this.out);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  };
  Sound.prototype.set = function (on) {
    this.on = on; writePref(on);
    if (on) this.unlock(); else if (this.ctx) this.ctx.suspend();
  };
  // vel 0..1 sets loudness, pan -1..1 follows the hit's horizontal position.
  Sound.prototype.note = function (semi, vel, pan) {
    var c = this.ctx;
    if (!this.on || !c || c.state !== "running") return;
    var t = c.currentTime, f = 261.63 * Math.pow(2, semi / 12);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + 0.3 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    var o1 = c.createOscillator(); o1.type = "triangle"; o1.frequency.value = f;
    var o2 = c.createOscillator(); o2.type = "sine"; o2.frequency.value = f * 2;
    var g2 = c.createGain(); g2.gain.value = 0.25;
    o1.connect(g); o2.connect(g2); g2.connect(g);
    var last = g;
    if (c.createStereoPanner) { var p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); last = p; }
    last.connect(this.out); last.connect(this.send);
    o1.start(t); o2.start(t); o1.stop(t + 1); o2.stop(t + 1);
  };

  // ---- Toy -----------------------------------------------------------------
  function mount(el) {
    if (el.__soltetToy) return;
    el.__soltetToy = true;
    var M = window.Matter;
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var sound = new Sound();

    var canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0";
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.style.touchAction = "pan-y";
    el.insertBefore(canvas, el.firstChild);
    var g = canvas.getContext("2d");

    // Use the page's own sound button if it provides one; otherwise add a default.
    var btn = el.querySelector("[data-soltet-toy-sound]"), ownBtn = !!btn;
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "soltet-toy-sound";
      btn.style.cssText = "position:absolute;right:20px;bottom:20px;z-index:3;font:600 15px 'Inrondround Opsz Wght',Nunito,sans-serif;" +
        "padding:10px 18px;border:2px solid #111;border-radius:999px;background:#fff;color:#111;cursor:pointer;box-shadow:0 3px 0 #111";
    }
    function label() {
      btn.textContent = sound.on ? "🔊 Sound on" : "🔊 Tap to hear";
      btn.setAttribute("aria-pressed", sound.on ? "true" : "false");
      btn.setAttribute("aria-label", sound.on ? "Sound on. Turn sound off" : "Turn sound on");
    }
    label();
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      sound.set(!sound.on); label();
    });
    if (!ownBtn) el.appendChild(btn);

    var engine = M.Engine.create();
    engine.gravity.y = 0.7;
    var W = 0, H = 0, dpr = 1, shapes = [], balls = [], sparks = [];

    function build() {
      var r = el.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      shapes.forEach(function (s) { M.Composite.remove(engine.world, s.body); });
      var narrow = W < 700, unit = narrow ? W : Math.min(W, H * 1.6);
      shapes = (narrow ? NARROW : WIDE).map(function (d) {
        var x = d.x * W, y = d.y * H, opt = { isStatic: true, restitution: 0.8, friction: 0.02 }, s = { d: d, flash: 0, r: d.r * unit };
        // Triangles point up (Matter's first vertex sits at 60 degrees, so turn it by -30).
        var body = d.t === "circle" ? M.Bodies.circle(x, y, s.r, opt)
          : M.Bodies.polygon(x, y, 3, s.r, Object.assign({ angle: -Math.PI / 6 }, opt));
        body.plugin.shape = s; s.body = body;
        M.Composite.add(engine.world, body);
        return s;
      });
    }

    function spawn(x, y) {
      if (balls.length >= MAX_BALLS) { var old = balls.shift(); M.Composite.remove(engine.world, old.body); }
      var r = 11 + Math.random() * 4;
      var body = M.Bodies.circle(x, y, r, { restitution: 0.8, friction: 0.02, frictionAir: 0.004, density: 0.002 });
      M.Body.setVelocity(body, { x: (Math.random() - 0.5) * 1.6, y: 0 });
      M.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.2); // so the X visibly turns
      var b = { body: body, r: r, idle: 0 };
      body.plugin.ball = b;
      balls.push(b);
      M.Composite.add(engine.world, body);
    }
    // Auto-spawned balls drop above a random shape so the toy plays itself.
    function autoSpawn() {
      var s = shapes[(Math.random() * shapes.length) | 0];
      if (s) spawn(s.body.position.x + (Math.random() - 0.5) * s.r * 1.4, -20);
    }

    M.Events.on(engine, "collisionStart", function (ev) {
      var now = performance.now();
      ev.pairs.forEach(function (p) {
        var s = p.bodyA.plugin.shape || p.bodyB.plugin.shape;
        var b = p.bodyA.plugin.ball || p.bodyB.plugin.ball;
        if (!s || !b || b.body.speed < 1.4 || now - (s.last || 0) < 70) return;
        s.last = now; s.flash = 1;
        var vel = Math.min(1, b.body.speed / 13);
        sound.note(SCALE[s.d.n], vel, Math.max(-1, Math.min(1, (b.body.position.x / W) * 2 - 1)) * 0.8);
        var pt = p.collision.supports[0] || b.body.position;
        for (var i = 0; i < 4; i++) {
          var a = Math.random() * Math.PI * 2, v = 1 + Math.random() * 2.5 * (0.4 + vel);
          sparks.push({ x: pt.x, y: pt.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, life: 1, size: 4 + Math.random() * 5 });
        }
      });
    });

    function star(x, y, r) { // four-point sparkle, like the site's star motif
      g.beginPath();
      for (var i = 0; i < 8; i++) {
        var a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.35 : r;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
    }
    // Outline of a shape around the origin, grown by `grow` px (used for the halo).
    function shapePath(s, grow) {
      g.beginPath();
      if (s.d.t === "circle") { g.arc(0, 0, s.r + grow, 0, Math.PI * 2); return; }
      var k = (s.r + grow * 2) / s.r, p = s.body.position;
      s.body.vertices.forEach(function (v) { g.lineTo((v.x - p.x) * k, (v.y - p.y) * k); });
      g.closePath();
    }

    function mix(a, b, t) { // hex colour lerp
      var pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), out = 0;
      for (var sh = 16; sh >= 0; sh -= 8) out |= Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t) << sh;
      return "#" + ("000000" + out.toString(16)).slice(-6);
    }

    function draw() {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.lineJoin = "round";
      shapes.forEach(function (s) {
        var p = s.body.position, f = s.flash, k = 1 + f * 0.1;
        var core = s.d.t === "circle" ? s.r * 0.6 : s.r * 0.3; // dark round centre
        g.save(); g.translate(p.x, p.y); g.scale(k, k);
        shapePath(s, s.r * 0.09); g.fillStyle = HALO; g.fill();
        if (f > 0.02) { g.shadowColor = GLOW; g.shadowBlur = 26 * f; }
        shapePath(s, 0); g.fillStyle = WHITE; g.fill();
        if (s.d.t !== "circle") { g.lineWidth = s.r * 0.07; g.strokeStyle = WHITE; g.stroke(); } // barely softened corners
        g.shadowBlur = 0;
        g.beginPath(); g.arc(0, 0, core, 0, Math.PI * 2); g.fillStyle = mix(CORE, CORE_HIT, f); g.fill();
        g.restore();
      });
      g.lineCap = "butt";
      balls.forEach(function (b) {
        var p = b.body.position, r = b.r, c = r * 0.74;
        g.globalAlpha = b.idle > 90 ? Math.max(0, 1 - (b.idle - 90) / 40) : 1;
        g.save(); g.translate(p.x, p.y); g.rotate(b.body.angle);
        g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fillStyle = BALL; g.fill();
        g.beginPath(); g.moveTo(-c, -c * 0.62); g.lineTo(c, c * 0.62); g.moveTo(-c * 0.62, c); g.lineTo(c * 0.62, -c);
        g.lineWidth = r * 0.24; g.strokeStyle = WHITE; g.stroke();
        g.restore();
      });
      g.fillStyle = WHITE;
      sparks.forEach(function (s, i) { g.globalAlpha = s.life; g.fillStyle = i % 2 ? MINT : WHITE; star(s.x, s.y, s.size * s.life); });
      g.globalAlpha = 1;
    }

    function step() {
      M.Engine.update(engine, STEP);
      for (var i = balls.length - 1; i >= 0; i--) {
        var b = balls[i], p = b.body.position;
        b.idle = b.body.speed < 0.25 ? b.idle + 1 : 0; // fade out balls that come to rest
        if (p.y > H + 60 || p.x < -60 || p.x > W + 60 || b.idle > 130) { M.Composite.remove(engine.world, b.body); balls.splice(i, 1); }
      }
      shapes.forEach(function (s) { s.flash = Math.max(0, s.flash - 0.05); });
      for (var j = sparks.length - 1; j >= 0; j--) {
        var s = sparks[j]; s.x += s.vx; s.y += s.vy; s.vy += 0.08; s.life -= 0.035;
        if (s.life <= 0) sparks.splice(j, 1);
      }
    }

    var visible = true, raf = 0, lastT = 0, acc = 0, nextSpawn = 0;
    function active() { return visible && !document.hidden; }
    function frame(t) {
      raf = 0;
      if (!active()) return;
      acc += Math.min(50, t - (lastT || t)); lastT = t;
      if (!reduced && t > nextSpawn && balls.length < AUTO_BALLS) { autoSpawn(); nextSpawn = t + 500 + Math.random() * 700; }
      while (acc >= STEP) { step(); acc -= STEP; }
      draw();
      // With reduced motion the loop only runs while visitor-dropped balls are in play.
      if (!reduced || balls.length || sparks.length) kick();
    }
    function kick() { if (!raf && active()) raf = requestAnimationFrame(frame); }
    function wake() { lastT = 0; kick(); }

    el.addEventListener("pointerdown", function (e) {
      sound.unlock();
      if (e.target.closest && e.target.closest("a,button,input,label,summary")) return;
      var r = el.getBoundingClientRect();
      spawn(e.clientX - r.left, e.clientY - r.top);
      wake();
    });
    // A remembered "sound on" still needs one gesture before the browser allows audio.
    ["pointerdown", "keydown"].forEach(function (n) { window.addEventListener(n, function () { sound.unlock(); }, { passive: true }); });
    document.addEventListener("visibilitychange", wake);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting; wake(); }).observe(el);
    }
    // Rebuild when the hero changes size (window resize, font load, content reflow).
    var rt;
    function resized() {
      clearTimeout(rt);
      rt = setTimeout(function () {
        var r = el.getBoundingClientRect();
        if (Math.abs(r.width - W) > 1 || Math.abs(r.height - H) > 1) { build(); draw(); }
      }, 120);
    }
    if ("ResizeObserver" in window) new ResizeObserver(resized).observe(el);
    else window.addEventListener("resize", resized);

    build();
    if (reduced) { // static frame: a few balls frozen mid-fall
      for (var i = 0; i < 6; i++) autoSpawn();
      for (var k = 0; k < 70; k++) { if (k % 12 === 0) autoSpawn(); M.Engine.update(engine, STEP); }
      draw();
    } else {
      kick();
    }
  }

  function init() {
    var els = document.querySelectorAll("[data-soltet-toy]");
    if (!els.length || !document.createElement("canvas").getContext) return;
    loadMatter(function () { Array.prototype.forEach.call(els, mount); });
  }
  window.SoltetToy = { version: VERSION, mount: function (el) { loadMatter(function () { mount(el); }); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
