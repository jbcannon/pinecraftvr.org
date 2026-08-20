// Loads shared HTML partials into any element with a data-include
// attribute, e.g. <div data-include="/partials/header.html"></div>
// Edit the files in /partials/ and every page picks up the change
// automatically, no copy-pasting into each page required.
document.querySelectorAll('[data-include]').forEach(function (el) {
  fetch(el.getAttribute('data-include'), { cache: 'no-store' })
    .then(function (res) { return res.text(); })
    .then(function (html) { el.outerHTML = html; })
    .catch(function (err) { console.error('Failed to load partial:', err); });
});

// Nav toggle: delegated on document since the header (and the button
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
// from). Submitting builds a mailto: link from the fields and hands off
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

// .video-click-overlay sits over the video (see main.css, it stops short
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

  // Optional timed caption list: a data-captions JSON array of {start,
  // end, text} (seconds) on .video-frame. Any video can opt in this way,
  // just add the attribute and a .video-caption-list div. Every cue is
  // rendered up front as a persistent item; only the "active" class
  // moves as playback progresses.
  if (frame.dataset.captions) {
    var cues = JSON.parse(frame.dataset.captions);
    var listEl = frame.querySelector('.video-caption-list');
    if (listEl) {
      var items = cues.map(function (cue) {
        var item = document.createElement('div');
        item.className = 'video-caption-item';
        var mark = document.createElement('span');
        mark.className = 'video-caption-item__mark';
        var text = document.createElement('span');
        text.className = 'video-caption-item__text';
        text.textContent = cue.text;
        item.appendChild(mark);
        item.appendChild(text);
        listEl.appendChild(item);
        return item;
      });
      video.addEventListener('timeupdate', function () {
        var t = video.currentTime;
        cues.forEach(function (cue, i) {
          items[i].classList.toggle('is-active', t >= cue.start && t < cue.end);
        });
      });
    }
  }
});

// Opens a <details> (e.g. a Getting Started guide section) when the URL
// hash points at it. Browsers vary on doing this automatically, so this
// guarantees a link like tutorial.html#vr-setup actually reveals it.
if (location.hash) {
  var target = document.getElementById(location.hash.slice(1));
  if (target && target.tagName === 'DETAILS') {
    target.open = true;
  }
}
