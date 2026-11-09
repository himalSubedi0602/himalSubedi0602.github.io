# himalSubedi0602.github.io

My personal website. When the page opens, drifting smoke condenses into a
tracing of my own eye, which then stays as the background.

Live at **https://himalSubedi0602.github.io** once GitHub Pages is turned on.

Inspired by the minimal, book-like layout of [lynnandtonic.com](https://lynnandtonic.com).

## How it's built

Plain HTML, CSS and JavaScript. No frameworks, no build step: open
`index.html` in a browser and it works.

```
index.html          Landing page: name, tagline, table of contents
about.html          I.   About
education.html      II.  Education
experience.html     III. Experience
projects.html       IV.  Projects
css/style.css       All styling (colours and fonts are at the top)
js/eye-paths.js     The lines of my eye, copied from assets/eye-tracing.svg
js/eye.js           The smoke and particle animation
assets/eye-tracing.svg   The original tracing of my eye
assets/favicon.svg       Browser tab icon
```

## How the eye animation works (js/eye.js)

The smoke is drawn by the GPU with WebGL, so it can look like real churning
smoke rather than dots.

1. **Mask:** the eye's lines (brow, crease, outline, iris, pupil, scar) are
   drawn once into a hidden image. Red = the lines, blue = a soft halo,
   green = *when* each part should appear (brow first, scar last, each line
   drawn from start to end).
2. **Smoke:** a fragment shader runs for every pixel, every frame, building
   smoke from layered noise (fbm) that is swirled by more noise (domain
   warping), the classic recipe for smoke and clouds.
3. **Shaping:** smoke appears where the mask says the eye is, but the mask is
   looked up at a swirled position, so the lines billow and wisps rise off them.
4. **Intro:** a smoke cloud gathers, then the lines condense out of it one by
   one as the cloud thins to a faint haze around the eye.
5. **Background:** dim, flowing smoke ribbons in violet with hints of gold.

The landing page plays the animation. Inner pages show the eye already
formed and much dimmer, so text stays readable. Visitors with "reduce motion"
turned on get a still image instead. The ✦ star on the landing page replays it.

To change the mood, edit `SETTINGS` near the top of `js/eye.js` (eye size,
brightness, intro length). Colours are in the shader, under `// --- colour`.

## Editing content

Text in *[square brackets]* is a placeholder. Replace it in the matching
`.html` file. To add another job or project, copy one `<li class="entry">`
block and edit it.

## Previewing locally

Double-click `index.html`, or run a tiny local server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
