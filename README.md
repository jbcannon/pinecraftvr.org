# Pinecraft site

Source for [pinecraftvr.org](https://pinecraftvr.org) — plain HTML/CSS/JS,
hosted on GitHub Pages. No build step, no Jekyll, no Ruby required.

## Working on this

See `todolist.txt` for the current state and what's next.

## Structure

- `index.html` — landing page
- `download.html` — real page (not a stub): the download button and system
  requirements, moved off the homepage
- `customize.html` — merged "Stand Generator" + "Your Forest" stub, as two
  sections on one page (dual content, one nav link)
- `about.html`, `contact.html`, `tutorial.html` — one page each, currently
  stubbed with a "Coming Soon" section until content is written
- No local "Open Source" page — that link goes straight to the Unreal
  project's GitHub repo once it's pushed (its README is the documentation)
- `partials/header.html`, `partials/footer.html` — the nav and
  credits/footer markup. **Edit these two files only** — every page pulls
  them in automatically at load time via `assets/js/main.js`, so you never
  copy-paste header/footer changes into each page by hand. Top nav is Home,
  Customize, Download, Tutorial, About; Open Source and Contact live in the
  footer instead, to keep the header from getting crowded.
- `assets/css/main.css` — all styling and theme colors (CSS variables at
  the top of the file)
- `assets/js/main.js` — loads the partials above, plus the mobile nav toggle
- `.nojekyll` — tells GitHub Pages to serve files as-is, skip its Jekyll build
- `media-source/` — large source video files, gitignored (too big for git;
  gets uploaded as a GitHub Release asset instead)

## Preview locally

The header/footer partials load via `fetch()`, which browsers block on
`file://` — double-clicking `index.html` will show a page missing its nav
and footer. Serve the folder over local HTTP instead:

- **VS Code:** install the "Live Server" extension, right-click
  `index.html` → "Open with Live Server."
- **Or, if you have Python installed:** `python -m http.server 8000` from
  this folder, then open http://localhost:8000

## Deploying

Push to the `main` branch — GitHub Pages serves the repo directly, no build
step runs.

## Adding a new page

Copy an existing page (e.g. `about.html`) as a starting point — it already
has the `<head>`, the two `data-include` divs, and the script tag wired up
correctly. Then add a link to it in `partials/header.html`.
