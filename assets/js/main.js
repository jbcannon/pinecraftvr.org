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

// Contact form has no server behind it (static site, no backend to send
// from) — submitting builds a mailto: link from the fields and hands off
// to the visitor's own email client, which sends it from their address.
var contactForm = document.getElementById('contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = contactForm.name.value.trim();
    var email = contactForm.email.value.trim();
    var affiliation = contactForm.affiliation.value.trim();
    var reason = contactForm.reason.value;
    var message = contactForm.message.value.trim();

    var subject = 'Pinecraft Contact: ' + reason;
    var body = [
      'Name: ' + (name || '(not provided)'),
      'Email: ' + email,
      'Affiliation: ' + (affiliation || '(not provided)'),
      '',
      message
    ].join('\n');

    window.location.href = 'mailto:pinecraft@jonesctr.org'
      + '?subject=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(body);
  });
}

// .video-click-overlay sits over the video (see main.css — it stops short
// of the native control bar strip), so a click anywhere on it toggles
// play/pause without ever competing with the browser's own controls.
document.querySelectorAll('.video-click-overlay').forEach(function (overlay) {
  var video = overlay.previousElementSibling;
  if (!video || video.tagName !== 'VIDEO') return;
  var frame = overlay.closest('.video-frame');

  overlay.addEventListener('click', function () {
    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  });

  // Reflects true playback state (not just clicks through this overlay),
  // so the big play icon also reappears if paused via the native controls.
  video.addEventListener('play', function () { frame.classList.add('is-playing'); });
  video.addEventListener('pause', function () { frame.classList.remove('is-playing'); });
});
