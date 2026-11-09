/*
 * The celestial eye.
 *
 * Draws a dark night sky on a full-screen <canvas>, then gathers thousands of
 * glowing particles out of drifting space dust onto the traced lines of
 * Himal's eye (js/eye-paths.js). Once formed, the eye stays as the background
 * and keeps a faint shimmer.
 *
 * Page options, set on <body>:
 *   data-eye="intro"  – landing page: play the gathering animation, and fit
 *                       the eye in the space above the element marked
 *                       [data-eye-above].
 *   data-eye="rest"   – inner pages: the eye is already formed, dimmer and
 *                       centred, so text on top stays easy to read.
 *
 * Visitors who ask their system for reduced motion get a still image.
 */
(function () {
  'use strict';

  const canvas = document.getElementById('sky');
  const drawing = window.EYE_DRAWING;
  if (!canvas || !canvas.getContext || !drawing) return;

  const ctx = canvas.getContext('2d');
  const body = document.body;
  const mode = body.dataset.eye === 'intro' ? 'intro' : 'rest';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------------------
  // Look & feel. Tweak these to change the mood.
  // ---------------------------------------------------------------------------

  // Particle colours (RGB). Kept mid-bright: visible, never glaring.
  const PALETTE = {
    violet:   [146, 112, 224],
    lavender: [196, 178, 246],
    indigo:   [96, 104, 214],
    ice:      [176, 196, 255],
    amber:    [232, 172, 104]
  };

  const SETTINGS = {
    eyeBrightness: mode === 'intro' ? 1 : 0.16, // overall eye opacity
    nebulaBrightness: mode === 'intro' ? 0.85 : 0.55,
    particlesPerPixel: 6,        // eye particles per pixel of eye width
    minParticles: 1800,
    maxParticles: 6000,
    lineThickness: 1.5,          // spread around each line, in tracing units
    hazeShare: 0.12,             // share of particles that float loosely as haze
    gatherSpeed: 1,              // >1 = faster intro, <1 = slower
    shimmer: 0.7                 // how far settled particles wobble, in px
  };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  // Seeded random numbers, so the sky looks the same every visit and resize.
  function seededRandom(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  const rand = Math.random;
  function gaussian(r) {
    // Roughly bell-shaped number between -1 and 1 (centre-weighted).
    return (r() + r() + r() - 1.5) / 1.5;
  }
  function pick(list, r) { return list[Math.floor(r() * list.length)]; }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // A smooth, slowly changing "wind" direction at any point: makes dust swirl
  // like smoke instead of moving in straight lines.
  function flowAngle(x, y, t) {
    const s = 0.0017;
    return (
      Math.sin(x * s + t * 0.15) +
      Math.cos(y * s * 1.3 - t * 0.11) +
      Math.sin((x + y) * s * 0.7 + t * 0.07)
    ) * Math.PI;
  }

  // One soft, glowing dot image per colour, drawn once and reused for speed.
  const sprites = {};
  Object.keys(PALETTE).forEach(function (key) {
    const [r, g, b] = PALETTE[key];
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g2 = c.getContext('2d');
    const grad = g2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grad.addColorStop(0.18, `rgba(${r},${g},${b},0.55)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},0.1)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    g2.fillStyle = grad;
    g2.fillRect(0, 0, size, size);
    sprites[key] = c;
  });

  // ---------------------------------------------------------------------------
  // 1. Turn the traced lines into lists of points
  // ---------------------------------------------------------------------------

  // The browser can measure SVG paths for us, so we put each path into a
  // hidden <svg>, walk along it in small steps, and record the points.
  function traceLines() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.visibility = 'hidden';
    body.appendChild(svg);

    const lines = drawing.paths.map(function (path) {
      const el = document.createElementNS(NS, 'path');
      el.setAttribute('d', path.d);
      svg.appendChild(el);
      const length = el.getTotalLength();
      const steps = Math.max(2, Math.ceil(length / 0.5));
      const points = [];
      for (let i = 0; i <= steps; i++) {
        const p = el.getPointAtLength((i / steps) * length);
        points.push([p.x, p.y]);
      }
      return Object.assign({}, path, { length: length, points: points });
    });

    svg.remove();
    return lines;
  }

  const lines = traceLines();

  // ---------------------------------------------------------------------------
  // 2. Create the particles
  // ---------------------------------------------------------------------------

  let eyeParticles = [];
  let dust = [];
  let stars = [];

  function createEyeParticles(total) {
    const totalWeight = lines.reduce((sum, l) => sum + l.length * l.density, 0);
    const particles = [];

    lines.forEach(function (line) {
      const count = Math.round(total * (line.length * line.density) / totalWeight);
      const pts = line.points;

      for (let k = 0; k < count; k++) {
        // Spread evenly along the line, with a little randomness.
        const along = (k + rand()) / count;
        const i = Math.min(pts.length - 2, Math.floor(along * (pts.length - 1)));
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];

        // Push the particle a little to either side of the line
        // (perpendicular to it) so the stroke looks soft and smoky.
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const isHaze = rand() < SETTINGS.hazeShare;
        const spread = SETTINGS.lineThickness * (isHaze ? 4.5 : 1);
        const offset = gaussian(rand) * spread;

        particles.push({
          // Home position, in tracing units
          lx: x0 - (dy / len) * offset,
          ly: y0 + (dx / len) * offset,
          color: pick(line.colors, rand),
          size: isHaze ? 0.9 + rand() * 1.4 : 0.7 + rand() * 1.0,
          alpha: isHaze ? 0.14 + rand() * 0.14 : 0.4 + rand() * 0.45,
          // Lines gather one after another, each one "drawn" from start to end
          delay: (0.25 + line.order * 0.42 + along * 0.7 + rand() * 0.45) / SETTINGS.gatherSpeed,
          duration: (1.7 + rand() * 0.9) / SETTINGS.gatherSpeed,
          phase: rand() * Math.PI * 2,
          wobble: 0.4 + rand() * 0.9,
          twinkle: 0.6 + rand() * 1.6,
          // Free-floating position before it reaches home (set in scatter())
          fx: 0,
          fy: 0
        });
      }
    });
    return particles;
  }

  // Place every eye particle somewhere out in the dust, ready to gather.
  function scatter() {
    const box = eyeBox();
    eyeParticles.forEach(function (p) {
      if (rand() < 0.6) {
        // Near the eye, in a cloud about twice its size
        p.fx = box.x + box.w / 2 + gaussian(rand) * box.w;
        p.fy = box.y + box.h / 2 + gaussian(rand) * box.h * 1.6;
      } else {
        p.fx = rand() * W;
        p.fy = rand() * H;
      }
    });
  }

  function createDust(count) {
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        x: rand() * W,
        y: rand() * H,
        color: pick(['violet', 'indigo', 'indigo', 'lavender', 'amber'], rand),
        size: 0.5 + rand() * 1.3,
        alpha: 0.06 + rand() * 0.16,
        speed: 6 + rand() * 14,
        phase: rand() * Math.PI * 2
      });
    }
    return list;
  }

  function createStars(count) {
    const r = seededRandom(42);
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        x: r(), // stored as 0..1 so they survive resizes
        y: r(),
        size: 0.25 + r() * r() * 1.1,
        alpha: 0.15 + r() * 0.5,
        speed: 0.4 + r() * 1.8,
        phase: r() * Math.PI * 2
      });
    }
    return list;
  }

  // ---------------------------------------------------------------------------
  // 3. Layout: where and how big the eye is on this screen
  // ---------------------------------------------------------------------------

  let W = 0, H = 0, dpr = 1;
  let scale = 1, originX = 0, originY = 0;
  const nebulaSmall = document.createElement('canvas'); // painted at low res
  const nebula = document.createElement('canvas');      // blurred, full size

  function eyeBox() {
    return { x: originX, y: originY, w: drawing.width * scale, h: drawing.height * scale };
  }

  function layout() {
    // The canvas is sized by CSS to fill the window; match its pixels to that.
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';

    let top = H * 0.04;
    let bottom = H * 0.94;
    let maxWidth = Math.min(W * 0.94, 1240);

    if (mode === 'intro') {
      // Fit the eye into the space above the title.
      const anchor = document.querySelector('[data-eye-above]');
      if (anchor) {
        const anchorTop = anchor.getBoundingClientRect().top;
        bottom = Math.max(H * 0.34, anchorTop - H * 0.015);
      }
      maxWidth = Math.min(W * 0.96, 1150);
    }

    const roomH = bottom - top;
    scale = Math.min(maxWidth / drawing.width, roomH / drawing.height);
    originX = (W - drawing.width * scale) / 2;
    originY = top + (roomH - drawing.height * scale) / 2;

    buildNebula();
  }

  // The coloured clouds: lots of very faint, soft blobs along a few ribbons,
  // painted once into a small canvas and stretched to fill the screen (which
  // makes them even softer).
  function buildNebula() {
    const q = 3; // draw at 1/3 size
    const nw = Math.ceil(W / q), nh = Math.ceil(H / q);
    nebulaSmall.width = nw;
    nebulaSmall.height = nh;
    const n = nebulaSmall.getContext('2d');
    n.clearRect(0, 0, nw, nh);
    n.globalCompositeOperation = 'lighter';

    const r = seededRandom(7);
    const box = eyeBox();
    const cx = (box.x + box.w / 2) / q;
    const cy = (box.y + box.h * 0.55) / q;
    const ew = Math.max(box.w / q, nw * 0.5);

    function blob(x, y, radius, rgb, alpha) {
      const g = n.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`);
      g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      n.fillStyle = g;
      n.beginPath();
      n.arc(x, y, radius, 0, Math.PI * 2);
      n.fill();
    }

    function ribbon(x0, y0, x1, y1, count, thickness, colors) {
      const wave = r() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const t = r();
        const x = x0 + (x1 - x0) * t + gaussian(r) * thickness * 0.4;
        const y = y0 + (y1 - y0) * t
          + Math.sin(t * Math.PI * 3 + wave) * thickness * 0.7
          + gaussian(r) * thickness * 0.5;
        const color = PALETTE[pick(colors, r)];
        blob(x, y, thickness * (0.3 + r() * 0.9), color, 0.022 + r() * 0.04);
      }
    }

    const cool = ['indigo', 'indigo', 'violet', 'violet', 'lavender'];
    const warm = ['violet', 'indigo', 'amber'];

    // A band of cloud flowing through the eye, slightly tilted
    ribbon(-0.1 * nw, cy + ew * 0.12, 1.1 * nw, cy - ew * 0.14, 170, ew * 0.2, cool);
    ribbon(cx - ew * 0.5, cy - ew * 0.12, cx + ew * 0.6, cy - ew * 0.22, 40, ew * 0.1, warm);
    // Wisps in the corners
    ribbon(0.55 * nw, 1.08 * nh, 1.1 * nw, 0.62 * nh, 70, ew * 0.14, cool);
    ribbon(-0.05 * nw, 0.02 * nh, 0.28 * nw, 0.22 * nh, 35, ew * 0.1, cool);

    // Stretch to full size (with some margin for drifting) and blur.
    nebula.width = W + 40;
    nebula.height = H + 40;
    const big = nebula.getContext('2d');
    big.imageSmoothingQuality = 'high';
    big.filter = 'blur(10px)';
    big.drawImage(nebulaSmall, 0, 0, nebula.width, nebula.height);
    big.filter = 'none';
  }

  // ---------------------------------------------------------------------------
  // 4. Drawing
  // ---------------------------------------------------------------------------

  let time = 0;          // seconds since the intro started
  let readyAt = 0;       // when the page text should fade in
  let isReady = false;

  function particleBudget() {
    const n = Math.round(drawing.width * scale * SETTINGS.particlesPerPixel);
    return Math.max(SETTINGS.minParticles, Math.min(SETTINGS.maxParticles, n));
  }

  function setup() {
    layout();
    eyeParticles = createEyeParticles(particleBudget());
    dust = createDust(Math.round(Math.min(1300, Math.max(260, (W * H) / 1100))));
    stars = createStars(Math.round(Math.min(700, (W * H) / 3800)));
    scatter();

    const lastDelay = eyeParticles.reduce((m, p) => Math.max(m, p.delay + p.duration), 0);
    readyAt = lastDelay * 0.55;
    // Inner pages and reduced-motion visitors skip straight to the formed eye.
    time = (mode === 'rest' || reduceMotion) ? lastDelay + 1 : 0;
  }

  function drawSprite(color, x, y, radius, alpha) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprites[color], x - radius, y - radius, radius * 2, radius * 2);
  }

  function render(dt) {
    // Background: deep blue-black, a touch lighter at the top
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b0918');
    sky.addColorStop(1, '#050409');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Nebula clouds, breathing and drifting very slowly
    const drift = Math.sin(time * 0.05) * 14;
    ctx.globalAlpha = SETTINGS.nebulaBrightness * (0.9 + Math.sin(time * 0.2) * 0.1);
    ctx.drawImage(nebula, -20 + drift, -20 - drift * 0.5);

    ctx.globalCompositeOperation = 'lighter';

    // Stars, gently twinkling
    for (const s of stars) {
      const a = s.alpha * (0.65 + 0.35 * Math.sin(time * s.speed + s.phase));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#e8e2ff';
      ctx.fillRect(s.x * W, s.y * H, s.size, s.size);
    }

    // Background dust, swirling forever
    for (const d of dust) {
      if (dt > 0) {
        const angle = flowAngle(d.x, d.y, time);
        d.x += (Math.cos(angle) * d.speed + 3) * dt;
        d.y += (Math.sin(angle) * d.speed + 1.5) * dt;
        if (d.x < -20) d.x += W + 40; else if (d.x > W + 20) d.x -= W + 40;
        if (d.y < -20) d.y += H + 40; else if (d.y > H + 20) d.y -= H + 40;
      }
      const a = d.alpha * (0.7 + 0.3 * Math.sin(time * 0.8 + d.phase));
      drawSprite(d.color, d.x, d.y, d.size * 3, a);
    }

    // The eye
    const shimmer = reduceMotion ? 0 : SETTINGS.shimmer * Math.max(0.6, scale / 2);
    for (const p of eyeParticles) {
      const local = time - p.delay;
      const progress = local <= 0 ? 0 : local >= p.duration ? 1 : easeInOutCubic(local / p.duration);

      // Until it has fully arrived, the particle keeps floating on the wind.
      if (progress < 1 && dt > 0) {
        const angle = flowAngle(p.fx, p.fy, time);
        p.fx += (Math.cos(angle) * 16 + 3) * dt;
        p.fy += (Math.sin(angle) * 16 + 1.5) * dt;
      }

      // Its home on the eye, plus a tiny wobble so the eye feels alive
      const hx = originX + p.lx * scale + Math.sin(time * p.wobble + p.phase) * shimmer;
      const hy = originY + p.ly * scale + Math.cos(time * p.wobble * 0.8 + p.phase) * shimmer;

      const x = p.fx + (hx - p.fx) * progress;
      const y = p.fy + (hy - p.fy) * progress;

      const glow = reduceMotion ? 1 : 0.8 + 0.2 * Math.sin(time * p.twinkle + p.phase);
      const alpha = p.alpha * (0.55 + 0.45 * progress) * glow * SETTINGS.eyeBrightness;
      const size = p.size * (2 - progress) * Math.max(0.8, Math.min(1.4, scale / 1.6));
      drawSprite(p.color, x, y, size * 3, alpha);
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    if (!isReady && time >= readyAt) {
      isReady = true;
      body.classList.add('is-ready');
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Run
  // ---------------------------------------------------------------------------

  setup();

  let last = performance.now();
  function frame(now) {
    // Cap the step so switching tabs doesn't make everything jump.
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += dt;
    render(dt);
    requestAnimationFrame(frame);
  }

  if (reduceMotion) {
    render(0);
  } else {
    requestAnimationFrame(function (now) { last = now; frame(now); });
  }

  // Re-fit the eye when the window changes size.
  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      layout();
      if (reduceMotion) render(0);
    }, 120);
  });

  // The little star on the landing page replays the intro.
  const replay = document.querySelector('[data-replay]');
  if (replay && !reduceMotion) {
    replay.addEventListener('click', function () {
      scatter();
      time = 0;
    });
  }
})();
