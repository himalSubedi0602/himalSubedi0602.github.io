/*
 * The smoke eye.
 *
 * Draws slow, drifting smoke on a full-screen <canvas>, then condenses
 * thousands of soft smoke particles onto the traced lines of Himal's eye
 * (js/eye-paths.js). Once formed, the eye stays as the background, breathing
 * gently, with a few wisps curling off its lines.
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

  // Smoke colours (RGB): muted greys with a hint of violet, and a dim ember.
  // The colour names match the ones used in js/eye-paths.js.
  const PALETTE = {
    lavender: [206, 200, 222],  // pale smoke
    ice:      [218, 216, 230],  // near-white smoke
    violet:   [146, 132, 190],  // violet haze
    indigo:   [112, 112, 162],  // deep haze
    amber:    [192, 160, 132]   // faint ember
  };

  const SETTINGS = {
    eyeBrightness: mode === 'intro' ? 1 : 0.24, // overall eye opacity
    smokeBrightness: mode === 'intro' ? 1 : 0.7, // background smoke opacity
    particlesPerPixel: 5,     // eye particles per pixel of eye width
    minParticles: 1400,
    maxParticles: 4200,
    lineThickness: 1.4,         // spread around each line, in tracing units
    wispShare: 0.14,            // share of particles that curl off as wisps
    gatherSpeed: 1,             // >1 = faster intro, <1 = slower
    breathe: 1.2                // how far settled smoke sways, in px
  };

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  // Seeded random numbers, so the smoke looks the same on every visit.
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

  // A smooth, slowly changing "wind" direction at any point, so smoke curls
  // instead of moving in straight lines.
  function flowAngle(x, y, t) {
    const s = 0.0016;
    return (
      Math.sin(x * s + t * 0.12) +
      Math.cos(y * s * 1.3 - t * 0.09) +
      Math.sin((x + y) * s * 0.7 + t * 0.05)
    ) * Math.PI;
  }

  // One soft puff image per colour, drawn once and reused for speed.
  // No bright centre: it fades evenly, like smoke rather than a star.
  const sprites = {};
  Object.keys(PALETTE).forEach(function (key) {
    const [r, g, b] = PALETTE[key];
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g2 = c.getContext('2d');
    const grad = g2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.85)`);
    grad.addColorStop(0.4, `rgba(${r},${g},${b},0.35)`);
    grad.addColorStop(0.75, `rgba(${r},${g},${b},0.08)`);
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
  let puffs = [];

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
        // (perpendicular to it) so the stroke looks soft.
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const isWisp = rand() < SETTINGS.wispShare;
        const offset = gaussian(rand) * SETTINGS.lineThickness * (isWisp ? 2.5 : 1);

        particles.push({
          // Home position, in tracing units
          lx: x0 - (dy / len) * offset,
          ly: y0 + (dx / len) * offset,
          color: pick(line.colors, rand),
          wisp: isWisp,
          size: isWisp ? 2 + rand() * 2 : 0.8 + rand() * 0.9,
          alpha: isWisp ? 0.03 + rand() * 0.04 : 0.07 + rand() * 0.08,
          // Lines gather one after another, each one "drawn" from start to end
          delay: (0.3 + line.order * 0.45 + along * 0.8 + rand() * 0.6) / SETTINGS.gatherSpeed,
          duration: (2 + rand() * 1.1) / SETTINGS.gatherSpeed,
          phase: rand() * Math.PI * 2,
          sway: 0.15 + rand() * 0.35,
          // Free-floating position before it reaches home (set in scatter())
          fx: 0,
          fy: 0
        });
      }
    });
    return particles;
  }

  // Place every eye particle somewhere in a loose cloud, ready to gather.
  function scatter() {
    const box = eyeBox();
    eyeParticles.forEach(function (p) {
      p.fx = box.x + box.w / 2 + gaussian(rand) * box.w * 0.9;
      p.fy = box.y + box.h * 0.6 + gaussian(rand) * box.h * 1.4;
    });
  }

  // Big, faint, slowly drifting puffs of background smoke.
  function createPuffs(count) {
    const r = seededRandom(11);
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        x: r() * W,
        y: r() * H,
        radius: 90 + r() * 220,
        color: pick(['indigo', 'indigo', 'violet', 'lavender'], r),
        alpha: 0.03 + r() * 0.04,
        speed: 4 + r() * 7,
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

    let top = H * 0.06;
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
      top = H * 0.04;
    }

    const roomH = bottom - top;
    scale = Math.min(maxWidth / drawing.width, roomH / drawing.height);
    originX = (W - drawing.width * scale) / 2;
    originY = top + (roomH - drawing.height * scale) / 2;
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
    puffs = createPuffs(Math.round(Math.min(70, Math.max(24, (W * H) / 20000))));
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
    // Background: almost black, with a hint of violet
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a090f');
    bg.addColorStop(1, '#050408');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = 'lighter';

    // Background smoke: large faint puffs, drifting and rising slowly
    for (const p of puffs) {
      if (dt > 0) {
        const angle = flowAngle(p.x, p.y, time);
        p.x += (Math.cos(angle) * p.speed + 2) * dt;
        p.y += (Math.sin(angle) * p.speed - 3) * dt;
        const m = p.radius;
        if (p.x < -m) p.x += W + 2 * m; else if (p.x > W + m) p.x -= W + 2 * m;
        if (p.y < -m) p.y += H + 2 * m; else if (p.y > H + m) p.y -= H + 2 * m;
      }
      const a = p.alpha * (0.8 + 0.2 * Math.sin(time * 0.15 + p.phase)) * SETTINGS.smokeBrightness;
      drawSprite(p.color, p.x, p.y, p.radius, a);
    }

    // The eye
    const unit = Math.max(0.8, Math.min(1.5, scale / 1.6)); // size relative to screen
    const breathe = reduceMotion ? 0 : SETTINGS.breathe * unit;
    for (const p of eyeParticles) {
      const local = time - p.delay;
      const progress = local <= 0 ? 0 : local >= p.duration ? 1 : easeInOutCubic(local / p.duration);

      // Until it has fully arrived, the particle drifts and rises like smoke.
      if (progress < 1 && dt > 0) {
        const angle = flowAngle(p.fx, p.fy, time);
        p.fx += (Math.cos(angle) * 14 + 2) * dt;
        p.fy += (Math.sin(angle) * 14 - 5) * dt;
      }

      // Its home on the eye. Wisps curl further from the line than the rest.
      const reach = p.wisp ? breathe * 5 : breathe;
      const hx = originX + p.lx * scale + Math.sin(time * p.sway + p.phase) * reach;
      const hy = originY + p.ly * scale + Math.cos(time * p.sway * 0.8 + p.phase) * reach
        - (p.wisp ? (0.5 + 0.5 * Math.sin(time * p.sway * 0.6 + p.phase)) * reach : 0);

      const x = p.fx + (hx - p.fx) * progress;
      const y = p.fy + (hy - p.fy) * progress;

      // While travelling it is a big faint puff; it condenses as it settles.
      const alpha = p.alpha * (0.18 + 0.82 * progress) * SETTINGS.eyeBrightness;
      const radius = p.size * unit * (6 + 26 * (1 - progress));
      drawSprite(p.color, x, y, radius, alpha);
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
