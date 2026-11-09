# himalSubedi0602.github.io

My personal website. When the page opens, drifting space dust gathers into a
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
js/eye.js           The sky and particle animation
assets/eye-tracing.svg   The original tracing of my eye
assets/favicon.svg       Browser tab icon
```

## How the eye animation works (js/eye.js)

1. **Trace:** each line of the eye (brow, crease, outline, iris, pupil, scar)
   is put into a hidden SVG so the browser can measure it, then sampled into
   points every half-unit along its length.
2. **Particles:** a few thousand particles get a "home" spread evenly along
   those lines, pushed slightly to either side so the strokes look smoky.
   Busier parts (iris, pupil, scar) get more particles per unit of length.
3. **Gather:** every particle starts somewhere in the dust and floats on a
   smooth "wind" (`flowAngle`). After a delay it eases towards its home.
   Delays go line by line, and along each line from start to end, so the eye
   looks like it's being drawn.
4. **Rest:** settled particles wobble and twinkle slightly so the eye stays alive.
5. **Sky:** soft nebula clouds (painted once, blurred, slowly drifting), twinkling
   stars, and background dust.

The landing page plays the animation. Inner pages show the eye already
formed and much dimmer, so text stays readable. Visitors with "reduce motion"
turned on get a still image instead. The ✦ star on the landing page replays it.

To change the mood, edit `PALETTE` and `SETTINGS` near the top of `js/eye.js`
(brightness, particle count, line thickness, speed).

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
