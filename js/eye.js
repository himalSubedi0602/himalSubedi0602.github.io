/*
 * The smoke eye.
 *
 * Renders animated smoke on the GPU (WebGL) and shapes it into the traced
 * lines of Himal's eye (js/eye-paths.js).
 *
 * How it works, in short:
 *   1. The eye's lines are drawn once into a hidden "mask" image. Its red
 *      channel holds the lines, blue holds a wide soft halo, and green holds
 *      *when* each bit of line should appear (brow first, scar last, each
 *      line drawn from start to end).
 *   2. A fragment shader runs for every pixel, every frame. It builds smoke
 *      texture from layered noise ("fbm") that is swirled by more noise
 *      ("domain warping"), the classic recipe for smoke and clouds.
 *   3. That smoke is shown where the mask says the eye is. The mask is
 *      sampled at a position pushed around by the swirl, so lines billow and
 *      wisps drift off them instead of looking like clean strokes.
 *   4. On the landing page, a smoke cloud gathers first, then the lines
 *      condense out of it one by one. Once the eye is formed, all the other
 *      smoke clears away and the eye settles to a calm, slow drift.
 *   5. Hovering over the eye (or tapping it) dissolves it back into smoke,
 *      and it forms again.
 *
 * Page options, set on <body>:
 *   data-eye="intro"  – landing page: play the intro, place the eye above
 *                       the element marked [data-eye-above].
 *   data-eye="rest"   – inner pages: eye already formed, dimmer, centred.
 *
 * Visitors who ask their system for reduced motion get a still image.
 * Without WebGL, the page simply shows its dark background.
 */
(function () {
  'use strict';

  const canvas = document.getElementById('sky');
  const drawing = window.EYE_DRAWING;
  const body = document.body;
  function showText() { body.classList.add('is-ready'); }
  if (!canvas || !drawing) return showText();

  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  if (!gl) return showText();

  const mode = body.dataset.eye === 'intro' ? 'intro' : 'rest';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------------------
  // Look & feel. Tweak these to change the mood.
  // ---------------------------------------------------------------------------
  const SETTINGS = {
    // Eye width as a share of the screen width, with limits in CSS pixels
    eyeWidth: mode === 'intro' ? 0.3 : 0.45,
    eyeMinWidth: 260,
    eyeMaxWidth: mode === 'intro' ? 480 : 640,
    eyeBrightness: mode === 'intro' ? 1 : 0.32,
    smokeBrightness: mode === 'intro' ? 1 : 0,    // background smoke ribbons (intro only)
    introSeconds: 4.5,      // time for all lines to condense
    dissolveSeconds: 1.1,   // hover: time to dissolve back into smoke
    reformSeconds: 3.2,     // hover: time to form again
    renderScale: 0.75       // render at 75% resolution; smoke is soft anyway
  };

  // Padding around the drawing inside the mask, so smoke can spill past it
  const PAD = 60;
  const MASK_SCALE = 2;     // mask pixels per tracing unit

  // ---------------------------------------------------------------------------
  // 1. Build the mask image from the traced lines
  // ---------------------------------------------------------------------------
  function buildMask() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.style.visibility = 'hidden';
    body.appendChild(svg);

    const mw = (drawing.width + PAD * 2) * MASK_SCALE;
    const mh = (drawing.height + PAD * 2) * MASK_SCALE;

    function layer() {
      const c = document.createElement('canvas');
      c.width = mw;
      c.height = mh;
      const x = c.getContext('2d');
      x.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, PAD * MASK_SCALE, PAD * MASK_SCALE);
      x.lineCap = 'round';
      x.lineJoin = 'round';
      return x;
    }
    const core = layer();   // the lines, soft-edged
    const halo = layer();   // a wide glow around them
    const order = layer();  // when each part appears

    const total = drawing.paths.length;
    drawing.paths.forEach(function (path) {
      const el = document.createElementNS(NS, 'path');
      el.setAttribute('d', path.d);
      svg.appendChild(el);
      const p2d = new Path2D(path.d);

      // Soft edges without blur filters: stack wide faint strokes under a
      // narrow strong one.
      [[7, 0.12], [4.5, 0.22], [2.6, 0.45], [1.3, 1]].forEach(function ([w, a]) {
        core.lineWidth = w;
        core.strokeStyle = `rgba(255,255,255,${a})`;
        core.stroke(p2d);
      });
      [[34, 0.05], [22, 0.08], [12, 0.12]].forEach(function ([w, a]) {
        halo.lineWidth = w;
        halo.strokeStyle = `rgba(255,255,255,${a})`;
        halo.stroke(p2d);
      });

      // Appearance time: walk along the path in short segments, each with a
      // slightly later time, so the line "draws" from start to end.
      const length = el.getTotalLength();
      const steps = Math.max(8, Math.ceil(length / 4));
      order.lineWidth = 40;
      let prev = el.getPointAtLength(0);
      for (let i = 1; i <= steps; i++) {
        const pt = el.getPointAtLength((i / steps) * length);
        const t = (path.order + (i / steps) * 0.9) / total; // 0..1
        order.strokeStyle = `rgb(0,${Math.round(20 + t * 215)},0)`;
        order.beginPath();
        order.moveTo(prev.x, prev.y);
        order.lineTo(pt.x, pt.y);
        order.stroke();
        prev = pt;
      }
    });
    svg.remove();

    // Combine the three layers into one RGBA image: R = core, G = order, B = halo
    const a = core.getImageData(0, 0, mw, mh).data;
    const b = halo.getImageData(0, 0, mw, mh).data;
    const o = order.getImageData(0, 0, mw, mh).data;
    const out = new Uint8Array(mw * mh * 4);
    for (let i = 0; i < out.length; i += 4) {
      out[i] = a[i + 3];                      // core coverage
      out[i + 1] = o[i + 3] ? o[i + 1] : 255; // order (255 = never)
      out[i + 2] = b[i + 3];                  // halo coverage
      out[i + 3] = 255;
    }
    return { data: out, width: mw, height: mh };
  }

  // ---------------------------------------------------------------------------
  // 2. The shaders
  // ---------------------------------------------------------------------------
  const VERTEX = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FRAGMENT = `
    precision highp float;

    uniform vec2  uRes;        // canvas size in pixels
    uniform float uTime;       // seconds
    uniform float uProgress;   // intro progress, 0 -> 1 (and beyond)
    uniform vec4  uEye;        // mask rectangle: x, y, width, height (px, top-left origin)
    uniform float uEyeAlpha;
    uniform float uSmokeAlpha;
    uniform sampler2D uMask;

    // --- noise ---------------------------------------------------------------
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    // Fractal noise: several layers of noise, each finer and fainter
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
      return v;
    }

    vec4 mask(vec2 px) {
      vec2 uv = (px - uEye.xy) / uEye.zw;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0, 1.0, 0.0, 0.0);
      return texture2D(uMask, uv);
    }

    void main() {
      vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); // top-left origin
      vec2 uv = px / uRes;
      float t = uTime;

      // --- swirling smoke field (domain-warped fbm), rising slowly ----------
      vec2 p = px / uRes.y * 2.4 + vec2(0.0, t * 0.03);
      vec2 q = vec2(fbm(p + vec2(0.0, t * 0.05)),
                    fbm(p + vec2(5.2, 1.3) - t * 0.04));
      vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 0.07),
                    fbm(p + 3.0 * q + vec2(8.3, 2.8) - t * 0.05));
      float n = fbm(p + 3.0 * r);

      // Finer smoke detail scaled to the eye, so its texture matches its size
      vec2 pe = (px - uEye.xy) / uEye.z * 7.0 + vec2(0.0, t * 0.12);
      float fine = fbm(pe + 2.5 * r + t * 0.05);

      // --- background: dim smoke ribbons, like the mockup -------------------
      float band1 = exp(-pow((uv.y - (0.78 - 0.55 * uv.x) + (q.x - 0.5) * 0.35) / 0.16, 2.0));
      float band2 = exp(-pow((uv.y - (1.42 - 0.62 * uv.x) + (q.y - 0.5) * 0.3) / 0.12, 2.0));
      float band3 = exp(-pow((uv.y - (0.12 - 0.25 * uv.x) + (r.x - 0.5) * 0.3) / 0.1, 2.0));
      float ribbons = (band1 * 0.55 + band2 * 0.4 + band3 * 0.3) * smoothstep(0.32, 0.95, n);
      float bgDensity = ribbons * 0.75 * uSmokeAlpha;

      // --- the eye ----------------------------------------------------------
      float eyeSize = uEye.z;
      // Push the lookup around with the swirl so the lines billow.
      // 0 while forming, 1 once settled: the eye calms down once it's formed
      float calm = smoothstep(1.0, 1.5, uProgress);
      vec2 disp = ((r - 0.5) * eyeSize * 0.05 + (q - 0.5) * eyeSize * 0.02) * mix(1.0, 0.4, calm);
      vec4 m = mask(px + disp);

      // Appear once the intro passes this part's time (green channel)
      float reveal = smoothstep(m.g - 0.06, m.g + 0.04, uProgress);

      // Wisps: the lines sampled a little lower and pushed harder, so smoke
      // seems to rise off them.
      vec2 rise = vec2((r.y - 0.5) * eyeSize * 0.08, eyeSize * (0.025 + 0.045 * fine));
      vec4 mw = mask(px + rise + disp * 1.8);
      float wispReveal = smoothstep(mw.g - 0.06, mw.g + 0.1, uProgress - 0.1);

      float lineDensity = m.r * smoothstep(0.22, 0.78, fine) * 1.1 * reveal;
      float haloDensity = m.b * smoothstep(0.3, 0.8, n * 0.5 + fine * 0.5) * 1.3 * reveal * mix(1.0, 0.45, calm);
      float wispDensity = mw.r * smoothstep(0.4, 0.85, fine) * 0.7 * wispReveal * (1.0 - calm);

      // The intro cloud: billowing smoke over the eye that thins as lines form
      vec2 ec = (px - (uEye.xy + uEye.zw * 0.5)) / uEye.zw;
      float ellipse = 1.0 - smoothstep(0.15, 0.55, length(ec * vec2(1.0, 1.25)));
      float cloudLife = smoothstep(0.0, 0.18, uProgress) * (1.0 - smoothstep(0.45, 1.1, uProgress));
      float cloud = ellipse * smoothstep(0.3, 0.85, n * 0.6 + fine * 0.5) * cloudLife * 0.9;

      float eyeDensity = (lineDensity + haloDensity + wispDensity + cloud) * uEyeAlpha;

      // --- colour -----------------------------------------------------------
      vec3 bg     = mix(vec3(0.038, 0.032, 0.065), vec3(0.018, 0.015, 0.03), uv.y);
      vec3 deep   = vec3(0.22, 0.17, 0.42);
      vec3 violet = vec3(0.52, 0.40, 0.80);
      vec3 pale   = vec3(0.80, 0.74, 0.96);
      vec3 amber  = vec3(0.92, 0.66, 0.38);

      vec3 smoke = mix(deep, violet, smoothstep(0.25, 0.8, n));
      smoke = mix(smoke, amber, smoothstep(0.58, 0.82, r.y) * 0.55);

      vec3 eyeCol = mix(violet, pale, smoothstep(0.55, 1.0, fine) * 0.8);
      eyeCol = mix(eyeCol, amber, smoothstep(0.6, 0.85, r.x) * 0.45);

      // Soft "exposure" curve so dense smoke glows without blowing out
      vec3 col = bg;
      col += smoke * (1.0 - exp(-bgDensity * 1.6));
      col += eyeCol * (1.0 - exp(-eyeDensity * 1.2)) * 0.8;

      // A little grain hides colour banding in dark gradients
      col += (hash(px + fract(t)) - 0.5) / 255.0;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return showText();
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(program));
    return showText();
  }
  gl.useProgram(program);

  // One big triangle that covers the whole screen
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Upload the mask
  const maskImage = buildMask();
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, maskImage.width, maskImage.height, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, maskImage.data);

  const u = {};
  ['uRes', 'uTime', 'uProgress', 'uEye', 'uEyeAlpha', 'uSmokeAlpha', 'uMask'].forEach(function (name) {
    u[name] = gl.getUniformLocation(program, name);
  });
  gl.uniform1i(u.uMask, 0);
  gl.uniform1f(u.uEyeAlpha, SETTINGS.eyeBrightness);

  // ---------------------------------------------------------------------------
  // 3. Layout: where and how big the eye is on this screen
  // ---------------------------------------------------------------------------
  let eyeRect = { x: 0, y: 0, w: 1, h: 1 }; // mask rectangle in CSS px, for hover

  function layout() {
    const W = canvas.clientWidth || window.innerWidth;
    const H = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const res = dpr * SETTINGS.renderScale;
    canvas.width = Math.max(1, Math.round(W * res));
    canvas.height = Math.max(1, Math.round(H * res));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);

    // Eye size (CSS px), from the drawing's own width
    const eyeW = Math.min(W * 0.9,
      Math.max(SETTINGS.eyeMinWidth, Math.min(SETTINGS.eyeMaxWidth, W * SETTINGS.eyeWidth)));
    let scale = eyeW / drawing.width;

    const cx = W / 2;
    let cy = H * 0.5;
    if (mode === 'intro') {
      // Centre the eye in the space above the title.
      const anchor = document.querySelector('[data-eye-above]');
      const room = Math.max(anchor ? anchor.getBoundingClientRect().top : H * 0.5, H * 0.25);
      scale = Math.min(scale, (room * 0.8) / drawing.height);
      cy = room * 0.52;
    }

    // Mask rectangle (includes padding), converted to canvas pixels
    const w = (drawing.width + PAD * 2) * scale;
    const h = (drawing.height + PAD * 2) * scale;
    const x = cx - w / 2;
    const y = cy - h / 2;
    gl.uniform4f(u.uEye, x * res, y * res, w * res, h * res);
    eyeRect = { x: x, y: y, w: w, h: h };
  }

  // ---------------------------------------------------------------------------
  // 4. Run
  // ---------------------------------------------------------------------------
  //
  // `progress` drives everything the shader shows:
  //   0      nothing yet          ~0.1–0.9  smoke cloud, lines condensing
  //   1      lines all formed     1.6       settled: smoke cleared, calm eye
  //
  // state: 'intro' → 'formed' → (hover) 'dissolve' → 'reform' → 'formed' …
  const SETTLED = 1.6;
  let state = (mode === 'rest' || reduceMotion) ? 'formed' : 'intro';
  let progress = state === 'formed' ? SETTLED : 0;
  let introFade = state === 'formed' ? 1 : 0; // background ribbons: 0 = shown, 1 = gone for good
  let isReady = false;
  const startTime = performance.now();
  let last = startTime;

  function step(dt) {
    if (state === 'intro' || state === 'reform') {
      const seconds = state === 'intro' ? SETTINGS.introSeconds : SETTINGS.reformSeconds;
      progress += dt / seconds;
      if (progress >= SETTLED) { progress = SETTLED; state = 'formed'; }
    } else if (state === 'dissolve') {
      progress -= dt * (SETTLED / SETTINGS.dissolveSeconds);
      if (progress <= 0.12) { progress = 0.12; state = 'reform'; }
    }
    // The background smoke only belongs to the first intro; once it has
    // cleared it stays gone.
    if (state === 'intro') introFade = Math.max(introFade, smoothstep(0.95, 1.45, progress));
    else introFade = 1;
  }

  function smoothstep(a, b, x) {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function draw(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    step(dt);
    gl.uniform1f(u.uTime, (now - startTime) / 1000 + 20); // +20: start mid-swirl
    gl.uniform1f(u.uProgress, progress);
    gl.uniform1f(u.uSmokeAlpha, SETTINGS.smokeBrightness * (1 - introFade));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!isReady && progress > 0.6) {
      isReady = true;
      showText();
    }
  }

  layout();

  if (reduceMotion) {
    draw(startTime);
  } else {
    (function loop(now) {
      draw(now);
      requestAnimationFrame(loop);
    })(startTime);
  }

  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      layout();
      if (reduceMotion) draw(performance.now());
    }, 120);
  });

  // ---------------------------------------------------------------------------
  // 5. Hover: dissolve the eye into smoke and form it again (landing page)
  // ---------------------------------------------------------------------------
  function dissolve() {
    if (state === 'formed') state = 'dissolve';
  }

  // Is this point (CSS px) on the eye's lines or the soft area around them?
  function isOnEye(clientX, clientY) {
    const uvx = (clientX - eyeRect.x) / eyeRect.w;
    const uvy = (clientY - eyeRect.y) / eyeRect.h;
    if (uvx < 0 || uvy < 0 || uvx >= 1 || uvy >= 1) return false;
    const i = (Math.floor(uvy * maskImage.height) * maskImage.width + Math.floor(uvx * maskImage.width)) * 4;
    return maskImage.data[i] > 30 || maskImage.data[i + 2] > 30; // line or halo
  }

  if (mode === 'intro' && !reduceMotion) {
    let wasOnEye = false;
    window.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      const onEye = isOnEye(e.clientX, e.clientY);
      if (onEye && !wasOnEye) dissolve(); // only when the pointer arrives
      wasOnEye = onEye;
    });
    // Touch screens have no hover, so a tap on the eye does the same.
    window.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse' && isOnEye(e.clientX, e.clientY)) dissolve();
    });
  }

  // The little star on the landing page also replays the eye.
  const replay = document.querySelector('[data-replay]');
  if (replay && !reduceMotion) replay.addEventListener('click', dissolve);
})();
