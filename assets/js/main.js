// Loads shared HTML partials into any element with a data-include
// attribute, e.g. <div data-include="/partials/header.html"></div>
// Edit the files in /partials/ and every page picks up the change
// automatically — no copy-pasting into each page required.
document.querySelectorAll('[data-include]').forEach(function (el) {
  fetch(el.getAttribute('data-include'))
    .then(function (res) { return res.text(); })
    .then(function (html) { el.outerHTML = html; })
    .catch(function (err) { console.error('Failed to load partial:', err); });
});

// Nav toggle — delegated on document since the header (and the button
// inside it) loads in asynchronously above.
document.addEventListener('click', function (e) {
  var toggle = e.target.closest('.nav-toggle');
  if (!toggle) return;
  var nav = document.getElementById('site-nav');
  var expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!expanded));
  nav.classList.toggle('is-open');
});
