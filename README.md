# Pinecraft site

Source for [pinecraftvr.org](https://pinecraftvr.org): plain HTML/CSS/JS, hosted on GitHub Pages.

## Working on this

See `todolist.txt` for the current state and what's next.

## Structure

-   `index.html`: landing page
-   `download.html`: real page (not a stub), with the download button and system requirements, moved off the homepage
-   `customize.html`: merged "Stand Generator" + "Your Forest" stub, as two sections on one page (dual content, one nav link)
-   `contact.html`: real page with intro copy, direct email link, and a contact form (mailto-based, no backend; see todolist.txt backlog)
-   `about.html`, `tutorial.html` ("Getting Started" in nav), `gallery.html`: one page each, currently stubbed with a "Coming Soon" section until content is written
-   No local "Open Source" page: that link goes straight to the Unreal project's GitHub repo once it's pushed (its README is the documentation)
-   `partials/header.html`, `partials/footer.html`: the nav and credits/footer markup. Every page pulls them in automatically at load time via `assets/js/main.js`
-   `assets/css/main.css`: all styling and theme colors (CSS variables at the top of the file)
-   `assets/js/main.js`: loads the partials above, plus the mobile nav toggle
-   `.nojekyll`: tells GitHub Pages to serve files as-is, skip its Jekyll build
-   `media-source/`: large source video files, gitignored (too big for git; gets uploaded as a GitHub Release asset instead)

## Publishing a new Pinecraft build

The Download button on `download.html` points at GitHub's "latest release" URL pattern, which always serves whichever release is currently marked "Latest" — no code change needed here when you ship a new build. To publish one:

1.  Name the build's zip **exactly** `pinecraftvr-windows.zip` — this filename has to stay identical every time, or the download link 404s until `download.html` is updated to match.
2.  Go to `https://github.com/jbcannon/pinecraftvr.org/releases/new` and draft a **new** release (don't edit an old one) — pick a fresh version tag (e.g. `v1.1`), target `main`, title it, write release notes.
3.  Upload `pinecraftvr-windows.zip` as the release asset.
4.  Leave "Set as the latest release" checked (it's the default) and publish.

That's it — the Download button picks up the new build automatically. Older releases stay archived in the repo's Releases history.