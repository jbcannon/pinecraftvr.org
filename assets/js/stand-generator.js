// Client-side port of stand_generator.R. Generates a synthetic longleaf
// pine stand (random or grid) and downloads it as a CustomMap CSV,
// entirely in the browser (no server, matches how the rest of this static
// site works). Runs only on customize.html, where #stand-generator-form
// exists.
//
// Unit note: the form can display metric or US units, but the CSV always
// contains metric values (cm, meters), same as the R script, since
// that's what Pinecraft's importer expects. The units toggle only
// converts what's shown on screen, both in the inputs and in the summary
// message after generating.
//
// Seed note: R and JavaScript use completely different random number
// generators, so the same seed will NOT produce an identical stand
// between this tool and stand_generator.R. Reproducibility only holds
// within each tool (same seed + same settings here always regenerates
// the same stand here).
(function () {
  var form = document.getElementById('stand-generator-form');
  if (!form) return;

  var CM_PER_IN = 2.54;
  var M_PER_FT = 0.3048;
  var ACRES_PER_HA = 2.47105;
  var BA_FACTOR = 1 / 4.356; // m²/ha <-> ft²/acre, same convention as the other US/metric factors

  var unitsRadios = document.querySelectorAll('input[name="sg-units"]');
  function isUS() {
    var checked = document.querySelector('input[name="sg-units"]:checked');
    return !!checked && checked.value === 'us';
  }
  function getPattern() {
    var checked = document.querySelector('input[name="sg-pattern"]:checked');
    return checked ? checked.value : 'random';
  }
  var statusEl = document.getElementById('sg-status');

  var resultsEl = document.getElementById('sg-results');
  var summarySizeEl = document.getElementById('sg-summary-size');
  var summaryCountEl = document.getElementById('sg-summary-count');
  var summaryDensityEl = document.getElementById('sg-summary-density');
  var summaryQmdEl = document.getElementById('sg-summary-qmd');
  var summaryBaEl = document.getElementById('sg-summary-ba');
  var summarySeedEl = document.getElementById('sg-summary-seed');

  var downloadBtn = document.getElementById('sg-download-btn');
  var lastCSV = null;
  var lastFilename = null;
  downloadBtn.addEventListener('click', function () {
    if (!lastCSV) return;
    downloadCSV(lastCSV, lastFilename);
  });

  // If any setting changes after a preview, the last-generated CSV no
  // longer matches what's on screen. Disable Download until Preview is
  // clicked again, so it's never possible to download a stand that
  // doesn't match the visible preview/settings.
  ['input', 'change'].forEach(function (evt) {
    form.addEventListener(evt, function (e) {
      // Toggling units only changes how numbers are displayed, not the
      // underlying settings, so it shouldn't invalidate the last preview.
      if (e.target && e.target.name === 'sg-units') return;
      if (downloadBtn.disabled || !lastCSV) return;
      downloadBtn.disabled = true;
      statusEl.style.color = '';
      statusEl.textContent = 'Settings changed. Click Generate to update before downloading.';
    });
  });

  var canvas = document.getElementById('sg-preview-canvas');
  var ctx = canvas.getContext('2d');
  var tooltipEl = document.getElementById('sg-preview-tooltip');
  var previewState = null; // { trees: [{x,y,dbh,height}], widthM, heightM, scale, dpr }

  var widthInput = document.getElementById('sg-width');
  var heightInput = document.getElementById('sg-height');
  var densityInput = document.getElementById('sg-density');
  var qmdInput = document.getElementById('sg-qmd');
  var sdInput = document.getElementById('sg-sd');
  var baInput = document.getElementById('sg-ba');
  var bimodalRange = document.getElementById('sg-bimodal-range');

  var widthRange = document.getElementById('sg-width-range');
  var heightRange = document.getElementById('sg-height-range');
  var densityRange = document.getElementById('sg-density-range');
  var qmdRange = document.getElementById('sg-qmd-range');
  var sdRange = document.getElementById('sg-sd-range');
  var baRange = document.getElementById('sg-ba-range');

  var widthScale = {
    min: document.getElementById('sg-width-scale-min'),
    mid: document.getElementById('sg-width-scale-mid'),
    max: document.getElementById('sg-width-scale-max')
  };
  var heightScale = {
    min: document.getElementById('sg-height-scale-min'),
    mid: document.getElementById('sg-height-scale-mid'),
    max: document.getElementById('sg-height-scale-max')
  };
  var densityScale = {
    min: document.getElementById('sg-density-scale-min'),
    mid: document.getElementById('sg-density-scale-mid'),
    max: document.getElementById('sg-density-scale-max')
  };
  var qmdScale = {
    min: document.getElementById('sg-qmd-scale-min'),
    mid: document.getElementById('sg-qmd-scale-mid'),
    max: document.getElementById('sg-qmd-scale-max')
  };
  var sdScale = {
    min: document.getElementById('sg-sd-scale-min'),
    mid: document.getElementById('sg-sd-scale-mid'),
    max: document.getElementById('sg-sd-scale-max')
  };
  var baScale = {
    min: document.getElementById('sg-ba-scale-min'),
    mid: document.getElementById('sg-ba-scale-mid'),
    max: document.getElementById('sg-ba-scale-max')
  };
  // Min/mid/max labels under the slider track, kept in sync with whatever
  // the current min/max happen to be (they move on every unit toggle).
  // Written directly as text rather than via a <datalist> — native range
  // tick marks never show numbers anyway, and rely on the browser
  // re-clamping ticks to a moved min/max, which isn't reliable everywhere.
  function setRangeScale(rangeEl, scale) {
    var min = parseFloat(rangeEl.min);
    var max = parseFloat(rangeEl.max);
    var mid = round1((min + max) / 2);
    scale.min.textContent = min;
    scale.mid.textContent = mid;
    scale.max.textContent = max;
  }

  // Slider <-> number stay in sync either direction. Typing a value outside
  // the slider's 10-250 range is still allowed in the number field. The
  // slider handle just clamps to whichever end is closest.
  function linkSlider(rangeEl, numberEl) {
    rangeEl.addEventListener('input', function () {
      numberEl.value = rangeEl.value;
    });
    numberEl.addEventListener('input', function () {
      var v = parseFloat(numberEl.value);
      if (isNaN(v)) return;
      var min = parseFloat(rangeEl.min), max = parseFloat(rangeEl.max);
      rangeEl.value = Math.max(min, Math.min(max, v));
    });
  }
  linkSlider(widthRange, widthInput);
  linkSlider(heightRange, heightInput);
  linkSlider(densityRange, densityInput);
  linkSlider(qmdRange, qmdInput);
  linkSlider(sdRange, sdInput);
  linkSlider(baRange, baInput);
  ['lopsided', 'leaning', 'chlorosis', 'firescar', 'canker', 'snag'].forEach(function (id) {
    linkSlider(document.getElementById('sg-' + id + '-range'), document.getElementById('sg-' + id));
  });

  function syncRangeToNumber(rangeEl, numberEl) {
    var min = parseFloat(rangeEl.min), max = parseFloat(rangeEl.max);
    var v = parseFloat(numberEl.value);
    if (isNaN(v)) return;
    rangeEl.value = Math.max(min, Math.min(max, v));
  }

  // Chain-link toggle: while linked, Width and Height move together as a
  // square (whichever you edit copies onto the other); click to break the
  // link and size them independently. Re-linking snaps Height to match
  // Width's current value.
  var dimsLinkBtn = document.getElementById('sg-dims-link');
  var dimsLinked = true;
  var LINK_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2" y="5" width="7" height="6" rx="3"/><rect x="7" y="5" width="7" height="6" rx="3"/></svg>';
  var UNLINK_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="1" y="5" width="6" height="6" rx="3"/><rect x="9" y="5" width="6" height="6" rx="3"/></svg>';
  function updateDimsLinkButton() {
    dimsLinkBtn.setAttribute('aria-pressed', dimsLinked ? 'true' : 'false');
    dimsLinkBtn.title = dimsLinked
      ? 'Width and height move together — click to size them independently'
      : 'Width and height move independently — click to link as a square';
    dimsLinkBtn.innerHTML = dimsLinked ? LINK_ICON : UNLINK_ICON;
  }
  dimsLinkBtn.addEventListener('click', function () {
    dimsLinked = !dimsLinked;
    if (dimsLinked) {
      heightInput.value = widthInput.value;
      syncRangeToNumber(heightRange, heightInput);
    }
    updateDimsLinkButton();
  });
  updateDimsLinkButton();
  [widthRange, widthInput].forEach(function (el) {
    el.addEventListener('input', function () {
      if (!dimsLinked) return;
      heightInput.value = widthInput.value;
      syncRangeToNumber(heightRange, heightInput);
    });
  });
  [heightRange, heightInput].forEach(function (el) {
    el.addEventListener('input', function () {
      if (!dimsLinked) return;
      widthInput.value = heightInput.value;
      syncRangeToNumber(widthRange, widthInput);
    });
  });

  // Live plot-area readout next to "Stand Dimensions", recomputed from
  // whatever's currently in the Width/Height fields (in whichever units
  // are displayed).
  var areaDisplayEl = document.getElementById('sg-area-display');
  function updateAreaDisplay() {
    var widthM = metricValueOf(widthInput, M_PER_FT);
    var heightM = metricValueOf(heightInput, M_PER_FT);
    if (!(widthM > 0) || !(heightM > 0)) {
      areaDisplayEl.textContent = '';
      return;
    }
    var areaHa = (widthM * heightM) / 10000;
    var us = isUS();
    var areaDisplay = us ? areaHa * ACRES_PER_HA : areaHa;
    areaDisplayEl.textContent = round1(areaDisplay) + ' ' + (us ? 'acres' : 'ha');
  }
  [widthRange, widthInput, heightRange, heightInput].forEach(function (el) {
    el.addEventListener('input', updateAreaDisplay);
  });

  var widthUnitEl = document.getElementById('sg-width-unit');
  var heightUnitEl = document.getElementById('sg-height-unit');
  var densityUnitEl = document.getElementById('sg-density-unit');
  var qmdUnitEl = document.getElementById('sg-qmd-unit');
  var sdUnitEl = document.getElementById('sg-sd-unit');
  var baUnitEl = document.getElementById('sg-ba-unit');

  function toMetric(usValue, factor) { return usValue * factor; }
  function toUS(metricValue, factor) { return metricValue / factor; }

  function convertFieldValue(input, factor, toUSUnits) {
    var v = parseFloat(input.value);
    if (isNaN(v)) return;
    var converted = toUSUnits ? toUS(v, factor) : toMetric(v, factor);
    input.value = round1(converted);
  }

  // Slider min/max are set from these fixed metric bounds every toggle,
  // never derived from whatever the slider currently has, so repeated
  // toggling back and forth can't drift the bounds.
  var METRIC_BOUNDS = {
    width: [10, 304.8], height: [10, 304.8],
    density: [10, 1980], qmd: [2.54, 100], sd: [1, 30], ba: [0.1, 57.4]
  };
  function setRangeBounds(rangeEl, metricMin, metricMax, factor, toUSUnits) {
    rangeEl.min = round1(toUSUnits ? toUS(metricMin, factor) : metricMin);
    rangeEl.max = round1(toUSUnits ? toUS(metricMax, factor) : metricMax);
  }

  // Slider steps chosen separately per unit system, not converted from one
  // another, so dragging always snaps to round, human-friendly increments
  // in whichever units are showing (converting e.g. a 1m step into US
  // units gives an oddball 3.28ft step; 1ft reads far better).
  var STEP_BY_UNIT = {
    width:   { metric: 1,   us: 1 },
    height:  { metric: 1,   us: 1 },
    density: { metric: 5,   us: 2 },
    qmd:     { metric: 0.5, us: 0.25 },
    sd:      { metric: 0.5, us: 0.25 },
    ba:      { metric: 0.1, us: 0.5 }
  };
  function setRangeStep(rangeEl, field, toUSUnits) {
    rangeEl.step = toUSUnits ? STEP_BY_UNIT[field].us : STEP_BY_UNIT[field].metric;
  }

  // Live-convert the displayed numbers (and unit labels) whenever the
  // toggle changes, so the real-world quantity stays the same; only the
  // number and label change. Generation itself re-derives metric values
  // from whatever's on screen at submit time, using this same checkbox
  // state. Also run once at load: the raw HTML defaults are authored in
  // metric, so if US units is the checked default, this brings the
  // displayed numbers/labels in line with that on first paint.
  function applyUnitsDisplay() {
    var us = isUS();
    convertFieldValue(widthInput, M_PER_FT, us);
    convertFieldValue(heightInput, M_PER_FT, us);
    convertFieldValue(densityInput, ACRES_PER_HA, us);
    convertFieldValue(qmdInput, CM_PER_IN, us);
    convertFieldValue(sdInput, CM_PER_IN, us);
    convertFieldValue(baInput, BA_FACTOR, us);
    setRangeBounds(widthRange, METRIC_BOUNDS.width[0], METRIC_BOUNDS.width[1], M_PER_FT, us);
    setRangeBounds(heightRange, METRIC_BOUNDS.height[0], METRIC_BOUNDS.height[1], M_PER_FT, us);
    setRangeBounds(densityRange, METRIC_BOUNDS.density[0], METRIC_BOUNDS.density[1], ACRES_PER_HA, us);
    setRangeBounds(qmdRange, METRIC_BOUNDS.qmd[0], METRIC_BOUNDS.qmd[1], CM_PER_IN, us);
    setRangeBounds(sdRange, METRIC_BOUNDS.sd[0], METRIC_BOUNDS.sd[1], CM_PER_IN, us);
    setRangeBounds(baRange, METRIC_BOUNDS.ba[0], METRIC_BOUNDS.ba[1], BA_FACTOR, us);
    setRangeStep(widthRange, 'width', us);
    setRangeStep(heightRange, 'height', us);
    setRangeStep(densityRange, 'density', us);
    setRangeStep(qmdRange, 'qmd', us);
    setRangeStep(sdRange, 'sd', us);
    setRangeStep(baRange, 'ba', us);
    setRangeScale(widthRange, widthScale);
    setRangeScale(heightRange, heightScale);
    setRangeScale(densityRange, densityScale);
    setRangeScale(qmdRange, qmdScale);
    setRangeScale(sdRange, sdScale);
    setRangeScale(baRange, baScale);
    syncRangeToNumber(widthRange, widthInput);
    syncRangeToNumber(heightRange, heightInput);
    syncRangeToNumber(densityRange, densityInput);
    syncRangeToNumber(qmdRange, qmdInput);
    syncRangeToNumber(sdRange, sdInput);
    syncRangeToNumber(baRange, baInput);

    widthUnitEl.textContent = us ? 'ft' : 'm';
    heightUnitEl.textContent = us ? 'ft' : 'm';
    densityUnitEl.textContent = us ? 'acre' : 'ha';
    qmdUnitEl.textContent = us ? 'in' : 'cm';
    sdUnitEl.textContent = us ? 'in' : 'cm';
    baUnitEl.innerHTML = us ? 'ft&sup2;/acre' : 'm&sup2;/ha';

    updateDerived();
    drawDistributionPreview();
    updateAreaDisplay();
  }
  unitsRadios.forEach(function (radio) {
    radio.addEventListener('change', applyUnitsDisplay);
  });

  // ── Density / QMD / Basal Area, kept in sync ────────────────────────────
  // These three are related exactly (not approximately) because QMD is
  // *defined* as the diameter of the tree of average basal area:
  //   BA (m²/ha) = density (trees/ha) × QMD (cm)² × π / 40000
  // All three stay editable. Whichever one hasn't been touched most
  // recently is treated as the "unknown" and recalculated live from the
  // other two — no explicit mode toggle needed. In steady-state use (someone
  // repeatedly nudging the same two fields) this settles into exactly the
  // same behavior an explicit toggle would give, it just never needs to be
  // set. It's a target only — the actual generated stand lands close to it,
  // not on it, since tree sizes are drawn randomly.
  var recency = ['density', 'qmd', 'ba']; // index 0 = touched most recently, last = least
  function touch(field) {
    var i = recency.indexOf(field);
    if (i > 0) recency.splice(i, 1), recency.unshift(field);
  }
  function getDerivedField() {
    return recency[recency.length - 1];
  }

  function baFromDensityQmd(densityHa, qmdCm) {
    return densityHa * qmdCm * qmdCm * Math.PI / 40000;
  }
  function densityFromBaQmd(baM2Ha, qmdCm) {
    return baM2Ha * 40000 / (Math.PI * qmdCm * qmdCm);
  }
  function qmdFromBaDensity(baM2Ha, densityHa) {
    return Math.sqrt(baM2Ha * 40000 / (Math.PI * densityHa));
  }

  function metricValueOf(input, factor) {
    var v = parseFloat(input.value);
    if (isNaN(v)) return NaN;
    return isUS() ? toMetric(v, factor) : v;
  }
  function writeDisplayValue(input, rangeEl, metricValue, factor) {
    var v = isUS() ? toUS(metricValue, factor) : metricValue;
    input.value = round1(v);
    syncRangeToNumber(rangeEl, input);
  }
  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  var derivedTagEls = {
    density: document.getElementById('sg-density-tag'),
    qmd: document.getElementById('sg-qmd-tag'),
    ba: document.getElementById('sg-ba-tag')
  };
  function updateDerivedTag(target) {
    Object.keys(derivedTagEls).forEach(function (name) {
      var tag = derivedTagEls[name];
      var isTarget = name === target;
      var field = tag.closest('.form-field');
      if (field) field.classList.toggle('is-derived', isTarget);
    });
  }

  // If editedField is given, this is a live user edit (slider drag or
  // typing), so an out-of-bounds derived value gets clamped to its
  // realistic limit and the field the user is actively editing gets pulled
  // back to whatever value keeps that limit — e.g. dragging QMD up can't
  // push the derived Basal Area past its max; the QMD slider just stops.
  // Without editedField (unit toggle, initial load) the derived value is
  // simply clamped on its own, no back-solving.
  function updateDerived(editedField) {
    var target = getDerivedField();
    var densityM = metricValueOf(densityInput, ACRES_PER_HA);
    var qmdM = metricValueOf(qmdInput, CM_PER_IN);
    var baM = metricValueOf(baInput, BA_FACTOR);

    if (target === 'ba' && densityM > 0 && qmdM > 0) {
      var rawBa = baFromDensityQmd(densityM, qmdM);
      var ba = clamp(rawBa, METRIC_BOUNDS.ba[0], METRIC_BOUNDS.ba[1]);
      if (ba !== rawBa) {
        if (editedField === 'qmd') {
          writeDisplayValue(qmdInput, qmdRange, qmdFromBaDensity(ba, densityM), CM_PER_IN);
        } else if (editedField === 'density') {
          writeDisplayValue(densityInput, densityRange, densityFromBaQmd(ba, qmdM), ACRES_PER_HA);
        }
      }
      writeDisplayValue(baInput, baRange, ba, BA_FACTOR);
    } else if (target === 'density' && baM > 0 && qmdM > 0) {
      var rawDensity = densityFromBaQmd(baM, qmdM);
      var density = clamp(rawDensity, METRIC_BOUNDS.density[0], METRIC_BOUNDS.density[1]);
      if (density !== rawDensity) {
        if (editedField === 'qmd') {
          writeDisplayValue(qmdInput, qmdRange, qmdFromBaDensity(baM, density), CM_PER_IN);
        } else if (editedField === 'ba') {
          writeDisplayValue(baInput, baRange, baFromDensityQmd(density, qmdM), BA_FACTOR);
        }
      }
      writeDisplayValue(densityInput, densityRange, density, ACRES_PER_HA);
    } else if (target === 'qmd' && baM > 0 && densityM > 0) {
      var rawQmd = qmdFromBaDensity(baM, densityM);
      var qmd = clamp(rawQmd, METRIC_BOUNDS.qmd[0], METRIC_BOUNDS.qmd[1]);
      if (qmd !== rawQmd) {
        if (editedField === 'density') {
          writeDisplayValue(densityInput, densityRange, densityFromBaQmd(baM, qmd), ACRES_PER_HA);
        } else if (editedField === 'ba') {
          writeDisplayValue(baInput, baRange, baFromDensityQmd(densityM, qmd), BA_FACTOR);
        }
      }
      writeDisplayValue(qmdInput, qmdRange, qmd, CM_PER_IN);
    }
    updateDerivedTag(target);
  }

  var FIELD_GROUPS = {
    density: [densityRange, densityInput],
    qmd: [qmdRange, qmdInput],
    ba: [baRange, baInput]
  };
  Object.keys(FIELD_GROUPS).forEach(function (name) {
    FIELD_GROUPS[name].forEach(function (el) {
      el.addEventListener('input', function () {
        touch(name);
        updateDerived(name);
      });
    });
  });

  // ── Small math helpers ──────────────────────────────────────────────────
  function round2(x) { return Math.round(x * 100) / 100; }
  function round1(x) { return Math.round(x * 10) / 10; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function mean(arr) { return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length; }
  function stddev(arr) {
    var m = mean(arr);
    var variance = mean(arr.map(function (x) { return (x - m) * (x - m); }));
    return Math.sqrt(variance);
  }

  // Deterministic PRNG (mulberry32) so a given seed always reproduces the
  // same stand within this tool.
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    var u1 = 0;
    while (u1 === 0) u1 = rng();
    var u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function bernoulli(rng, p) { return rng() < p ? 1 : 0; }

  // ── Core generation, ported from stand_generator.R ──────────────────────

  // Log-normal parameterization targeting a given QMD and SD (same as
  // .draw_dbh() in stand_generator.R). Shared by the actual random draw
  // below and by the theoretical preview curve, so the chart always shows
  // exactly the distribution trees are really being drawn from.
  function logNormalParams(qmd, sdDbh) {
    var sigma2 = Math.log(1 + Math.pow(sdDbh / qmd, 2));
    return { mu: Math.log(qmd) - sigma2, sigma: Math.sqrt(sigma2) };
  }

  function drawDBH(n, qmd, sdDbh, rng) {
    var lp = logNormalParams(qmd, sdDbh);
    var out = [];
    for (var i = 0; i < n; i++) {
      var dbh = Math.exp(lp.mu + lp.sigma * gaussian(rng));
      out.push(Math.max(0.1, round2(dbh)));
    }
    return out;
  }

  // Bimodal splits the stand into two equal-sized cohorts with QMDs pulled
  // symmetrically apart from the target QMD, each still drawn with the same
  // SD. At bimodalT=0 both cohorts collapse back to a single drawDBH call.
  // Cohort assignment is shuffled (not tied to tree generation order) so
  // the two size classes end up scattered across the plot rather than
  // clustered — this matters most for the grid pattern, where leaving the
  // first half of trees in cohort 1 would visibly segregate them by row.
  function drawDBHMixture(n, qmd, sdDbh, bimodalT, rng) {
    if (!(bimodalT > 0)) return drawDBH(n, qmd, sdDbh, rng);
    var halfSep = bimodalT * 2 * sdDbh;
    var qmdLow = Math.max(0.5, qmd - halfSep);
    var qmdHigh = qmd + halfSep;
    var n1 = Math.round(n / 2);
    var combined = drawDBH(n1, qmdLow, sdDbh, rng).concat(drawDBH(n - n1, qmdHigh, sdDbh, rng));
    for (var i = combined.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = combined[i]; combined[i] = combined[j]; combined[j] = tmp;
    }
    return combined;
  }

  // Chapman-Richards H-D model calibrated to longleaf pine (same formula
  // as .height_from_dbh() in stand_generator.R).
  function heightFromDBH(dbhArr, rng) {
    return dbhArr.map(function (dbh) {
      var h = 1.37 + 31 * Math.pow(1 - Math.exp(-0.035 * dbh), 1.2) + gaussian(rng) * 0.8;
      return Math.max(1, round2(h));
    });
  }

  // A snag is recorded as dead with every other defect forced off. A
  // standing dead tree isn't also "lopsided" or "fire-scarred," it's just
  // dead. Snag status is checked first, per tree, before the rest.
  function buildDefects(n, params, rng) {
    var out = { Alive: [], Lopsided: [], Leaning: [], Chlorosis: [], FireScar: [], Canker: [] };
    for (var i = 0; i < n; i++) {
      var isSnag = bernoulli(rng, params.pSnag);
      out.Alive.push(isSnag ? 0 : 1);
      out.Lopsided.push(isSnag ? 0 : bernoulli(rng, params.pLopsided));
      out.Leaning.push(isSnag ? 0 : bernoulli(rng, params.pLeaning));
      out.Chlorosis.push(isSnag ? 0 : bernoulli(rng, params.pChlorosis));
      out.FireScar.push(isSnag ? 0 : bernoulli(rng, params.pFirescar));
      out.Canker.push(isSnag ? 0 : bernoulli(rng, params.pCanker));
    }
    return out;
  }

  function generateRandom(p, rng) {
    var areaHa = (p.widthM * p.heightM) / 10000;
    var n = Math.round(p.density * areaHa);
    if (n < 1) throw new Error('Density too low: zero trees over this plot size.');

    var X = [], Y = [];
    for (var i = 0; i < n; i++) {
      X.push(rng() * p.widthM);
      Y.push(rng() * p.heightM);
    }
    var DBH = drawDBHMixture(n, p.qmd, p.sd, p.bimodal, rng);
    var Height = heightFromDBH(DBH, rng);
    var defects = buildDefects(n, p, rng);
    return { X: X, Y: Y, DBH: DBH, Height: Height, defects: defects, n: n, areaHa: areaHa };
  }

  function generateGrid(p, rng) {
    var spacing = Math.sqrt(10000 / p.density);
    var nx = Math.floor(p.widthM / spacing);
    var ny = Math.floor(p.heightM / spacing);
    if (nx < 1 || ny < 1) {
      throw new Error('Density too low for this plot size: spacing between trees would exceed the plot dimensions.');
    }
    var xMargin = (p.widthM - (nx - 1) * spacing) / 2;
    var yMargin = (p.heightM - (ny - 1) * spacing) / 2;

    // Real planting isn't laser-precise. A small jitter keeps the grid
    // from looking artificially perfect.
    var JITTER_M = 0.25;
    var X = [], Y = [];
    for (var iy = 0; iy < ny; iy++) {
      for (var ix = 0; ix < nx; ix++) {
        X.push(xMargin + ix * spacing + (rng() * 2 - 1) * JITTER_M);
        Y.push(yMargin + iy * spacing + (rng() * 2 - 1) * JITTER_M);
      }
    }
    var n = X.length;
    var DBH = drawDBHMixture(n, p.qmd, p.sd, p.bimodal, rng);
    var Height = heightFromDBH(DBH, rng);
    var defects = buildDefects(n, p, rng);
    var areaHa = (p.widthM * p.heightM) / 10000;
    return { X: X, Y: Y, DBH: DBH, Height: Height, defects: defects, n: n, areaHa: areaHa };
  }

  // Matches .build_df() + write.csv(..., quote=FALSE) exactly: same
  // column names/order, same number formatting.
  function buildCSV(r) {
    var header = ['X', 'Y', 'Class', 'Scientific Name', 'Common Name', 'Alive',
      'Height', 'DBH', 'Lopsided', 'Leaning', 'Chlorosis', 'FireScar', 'Canker', 'Marked'];
    var lines = [header.join(',')];
    for (var i = 0; i < r.n; i++) {
      lines.push([
        r.X[i].toFixed(6),
        r.Y[i].toFixed(6),
        'Tree',
        'Pinus palustris',
        'Longleaf Pine',
        r.defects.Alive[i] ? 'true' : 'false',
        r.Height[i].toFixed(2),
        r.DBH[i].toFixed(2),
        r.defects.Lopsided[i],
        r.defects.Leaning[i],
        r.defects.Chlorosis[i],
        r.defects.FireScar[i],
        r.defects.Canker[i],
        'false'
      ].join(','));
    }
    return lines.join('\n');
  }

  // ── Stand preview (canvas scatter, sized by DBH) ────────────────────────
  function drawPreview(result, widthM, heightM) {
    var maxCssPx = 640;
    var scale = maxCssPx / Math.max(widthM, heightM);
    var cssW = widthM * scale;
    var cssH = heightM * scale;
    var dpr = window.devicePixelRatio || 1;

    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var dbhMin = Math.min.apply(null, result.DBH);
    var dbhMax = Math.max.apply(null, result.DBH);
    var rMin = 2, rMax = 9;

    var GREEN = 'rgba(127, 194, 92, 0.85)';
    var DEFECT_RING = 'rgba(214, 133, 41, 0.95)';
    var FIRESCAR_RING = 'rgba(25, 22, 20, 0.95)';

    var d = result.defects;
    var trees = [];
    for (var i = 0; i < result.n; i++) {
      var t = dbhMax > dbhMin ? (result.DBH[i] - dbhMin) / (dbhMax - dbhMin) : 0.5;
      var r = rMin + t * (rMax - rMin);
      var px = result.X[i] * scale;
      var py = cssH - result.Y[i] * scale; // flip Y so it reads bottom-up like a map

      var isSnag = !d.Alive[i];
      var hasFireScar = !!d.FireScar[i];
      // Fire scar gets its own symbol; any other defect just flags a ring.
      var hasOtherDefect = !!(d.Lopsided[i] || d.Leaning[i] || d.Chlorosis[i] || d.Canker[i]);
      var defectLabels = [];
      if (d.Lopsided[i]) defectLabels.push('Asymmetric Crown');
      if (d.Leaning[i]) defectLabels.push('Leaning');
      if (d.Chlorosis[i]) defectLabels.push('Chlorosis');
      if (d.FireScar[i]) defectLabels.push('Fire Scar');
      if (d.Canker[i]) defectLabels.push('Canker');

      trees.push({
        x: result.X[i], y: result.Y[i], px: px, py: py, r: r,
        dbh: result.DBH[i], height: result.Height[i],
        isSnag: isSnag, defectLabels: defectLabels
      });

      if (isSnag) {
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fillStyle = '#000000';
        ctx.fill();
        continue;
      }

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = GREEN;
      ctx.fill();

      var ringR = r + 2;
      if (hasFireScar) {
        // Fire scars read as char-black, so plain black works on the
        // light plot background.
        ctx.beginPath();
        ctx.arc(px, py, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = FIRESCAR_RING;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ringR += 3;
      }

      if (hasOtherDefect) {
        ctx.beginPath();
        ctx.arc(px, py, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = DEFECT_RING;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Scale bar: a "nice" round distance roughly a fifth of the plot
    // width, shown in whichever units the form currently displays. The
    // underlying plot/tree positions are always metric internally; only
    // this label (and which "nice" number reads well) changes with units.
    var us = isUS();
    var niceStepsMetric = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
    var niceStepsUS = [5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000];
    var niceSteps = us ? niceStepsUS : niceStepsMetric;
    var widthDisplay = us ? toUS(widthM, M_PER_FT) : widthM;
    var target = widthDisplay / 5;
    var barDisplay = niceSteps[0];
    for (var s = 0; s < niceSteps.length; s++) {
      if (niceSteps[s] <= target) barDisplay = niceSteps[s];
    }
    var barM = us ? toMetric(barDisplay, M_PER_FT) : barDisplay;
    var barPx = barM * scale;
    var barX = 12, barY = cssH - 16;
    ctx.strokeStyle = 'rgba(75,83,70,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(barX, barY);
    ctx.lineTo(barX + barPx, barY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(75,83,70,0.9)';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(barDisplay + (us ? ' ft' : ' m'), barX, barY - 6);

    previewState = { trees: trees, cssW: cssW, cssH: cssH };
  }

  canvas.addEventListener('mousemove', function (e) {
    if (!previewState) return;
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;

    var nearest = null, nearestDist = 10; // px hit radius
    for (var i = 0; i < previewState.trees.length; i++) {
      var t = previewState.trees[i];
      var d = Math.hypot(t.px - mx, t.py - my);
      if (d < nearestDist) { nearestDist = d; nearest = t; }
    }

    if (nearest) {
      var us = isUS();
      var dbhDisplay = us ? toUS(nearest.dbh, CM_PER_IN) : nearest.dbh;
      var heightDisplay = us ? toUS(nearest.height, M_PER_FT) : nearest.height;
      var diamUnit = us ? 'in' : 'cm';
      var lenUnit = us ? 'ft' : 'm';
      var label = 'DBH ' + dbhDisplay.toFixed(1) + ' ' + diamUnit + ' · Height ' + heightDisplay.toFixed(1) + ' ' + lenUnit;
      if (nearest.isSnag) {
        label += ' · Snag (dead)';
      } else if (nearest.defectLabels.length) {
        label += ' · ' + nearest.defectLabels.join(', ');
      }
      tooltipEl.textContent = label;
      tooltipEl.style.left = nearest.px + 'px';
      tooltipEl.style.top = nearest.py + 'px';
      tooltipEl.classList.add('is-visible');
    } else {
      tooltipEl.classList.remove('is-visible');
    }
  });
  canvas.addEventListener('mouseleave', function () {
    tooltipEl.classList.remove('is-visible');
  });

  // Basal area (m²/ha): sum of every tree's cross-sectional area at breast
  // height, per hectare. Snags are included (not excluded), so this stays
  // exactly consistent with the density/QMD/BA solve-for relationship
  // above, which is defined over all trees regardless of Alive status.
  function basalAreaPerHa(result) {
    var totalM2 = 0;
    for (var i = 0; i < result.n; i++) {
      var dbhM = result.DBH[i] / 100;
      totalM2 += (Math.PI / 4) * dbhM * dbhM;
    }
    return totalM2 / result.areaHa;
  }

  // ── Projected diameter distribution (theoretical preview curve) ─────────
  // Unlike the histogram below, this isn't sampled from a generated stand —
  // it's the log-normal PDF(s) implied directly by the current QMD/SD/
  // Bimodal fields, using the exact same logNormalParams() the real draw
  // uses, so it updates live as those sliders move, before Generate is ever
  // clicked.
  var distCanvas = document.getElementById('sg-distribution-canvas');
  var distCtx = distCanvas ? distCanvas.getContext('2d') : null;
  var distScaleMinEl = document.getElementById('sg-distribution-scale-min');
  var distScaleMidEl = document.getElementById('sg-distribution-scale-mid');
  var distScaleMaxEl = document.getElementById('sg-distribution-scale-max');

  function lognormalPDF(x, mu, sigma) {
    if (x <= 0) return 0;
    var z = (Math.log(x) - mu) / sigma;
    return Math.exp(-0.5 * z * z) / (x * sigma * Math.sqrt(2 * Math.PI));
  }

  function drawDistributionPreview() {
    if (!distCtx) return;
    var qmd = metricValueOf(qmdInput, CM_PER_IN);
    var sd = metricValueOf(sdInput, CM_PER_IN);
    var bimodalT = bimodalRange ? parseFloat(bimodalRange.value) : 0;
    if (!(qmd > 0) || !(sd > 0)) return;

    var halfSep = bimodalT * 2 * sd;
    var qmdLow = Math.max(0.5, qmd - halfSep);
    var qmdHigh = qmd + halfSep;
    var pLow = logNormalParams(qmdLow, sd);
    var pHigh = logNormalParams(qmdHigh, sd);

    // Fixed 0-to-max-QMD frame (rather than auto-zooming to the current
    // curve) so the axis stays put as sliders move, making it easy to
    // compare shapes across different settings. A separated bimodal curve
    // can run past this and get clipped at the right edge — acceptable,
    // since the frame staying fixed is the point.
    var xMin = 0;
    var xMax = METRIC_BOUNDS.qmd[1];

    var cssW = 600, cssH = 140;
    var dpr = window.devicePixelRatio || 1;
    distCanvas.style.width = '100%';
    distCanvas.style.height = cssH + 'px';
    distCanvas.width = cssW * dpr;
    distCanvas.height = cssH * dpr;
    distCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    distCtx.clearRect(0, 0, cssW, cssH);

    var padL = 4, padR = 4, padT = 8, padB = 4;
    var plotW = cssW - padL - padR;
    var plotH = cssH - padT - padB;

    var STEPS = 160;
    var ys = [];
    var maxY = 0;
    for (var i = 0; i <= STEPS; i++) {
      var x = xMin + (xMax - xMin) * (i / STEPS);
      var y = 0.5 * lognormalPDF(x, pLow.mu, pLow.sigma) + 0.5 * lognormalPDF(x, pHigh.mu, pHigh.sigma);
      ys.push(y);
      if (y > maxY) maxY = y;
    }
    if (!(maxY > 0)) return;

    function pointAt(i) {
      return {
        x: padL + (i / STEPS) * plotW,
        y: padT + plotH - (ys[i] / maxY) * plotH
      };
    }

    distCtx.beginPath();
    for (var s = 0; s <= STEPS; s++) {
      var pt = pointAt(s);
      if (s === 0) distCtx.moveTo(pt.x, pt.y); else distCtx.lineTo(pt.x, pt.y);
    }
    distCtx.lineTo(padL + plotW, padT + plotH);
    distCtx.lineTo(padL, padT + plotH);
    distCtx.closePath();
    distCtx.fillStyle = 'rgba(90,111,61,0.25)';
    distCtx.fill();

    distCtx.beginPath();
    for (var s2 = 0; s2 <= STEPS; s2++) {
      var pt2 = pointAt(s2);
      if (s2 === 0) distCtx.moveTo(pt2.x, pt2.y); else distCtx.lineTo(pt2.x, pt2.y);
    }
    distCtx.strokeStyle = 'rgba(90,111,61,0.9)';
    distCtx.lineWidth = 2;
    distCtx.stroke();

    distCtx.strokeStyle = 'rgba(75,83,70,0.4)';
    distCtx.lineWidth = 1;
    distCtx.beginPath();
    distCtx.moveTo(padL, padT + plotH);
    distCtx.lineTo(padL + plotW, padT + plotH);
    distCtx.stroke();

    var us = isUS();
    var unitLabel = us ? ' in' : ' cm';
    function fmt(v) { return (us ? toUS(v, CM_PER_IN) : v).toFixed(1) + unitLabel; }
    if (distScaleMinEl) distScaleMinEl.textContent = fmt(xMin);
    if (distScaleMidEl) distScaleMidEl.textContent = fmt(qmd);
    if (distScaleMaxEl) distScaleMaxEl.textContent = fmt(xMax);
  }

  [qmdRange, qmdInput, sdRange, sdInput, bimodalRange].forEach(function (el) {
    el.addEventListener('input', drawDistributionPreview);
  });

  // ── Diameter distribution (histogram) ───────────────────────────────────
  var histCanvas = document.getElementById('sg-histogram-canvas');
  var histCtx = histCanvas.getContext('2d');
  var histTooltipEl = document.getElementById('sg-histogram-tooltip');
  var histState = null;

  function drawHistogram(result, us) {
    // Bins are 2cm wide on the underlying metric DBH, snapped to clean
    // 2cm breaks (not an arbitrary continuous width), same breaks
    // regardless of which units are currently displayed.
    var BIN_WIDTH_CM = 2;
    var minCm = Math.floor(Math.min.apply(null, result.DBH) / BIN_WIDTH_CM) * BIN_WIDTH_CM;
    var maxCm = Math.ceil(Math.max.apply(null, result.DBH) / BIN_WIDTH_CM) * BIN_WIDTH_CM;
    var binCount = Math.max(1, Math.round((maxCm - minCm) / BIN_WIDTH_CM));
    var bins = new Array(binCount).fill(0);
    result.DBH.forEach(function (dbh) {
      var idx = Math.min(binCount - 1, Math.floor((dbh - minCm) / BIN_WIDTH_CM));
      bins[idx]++;
    });
    var maxCount = Math.max.apply(null, bins);
    var minD = us ? toUS(minCm, CM_PER_IN) : minCm;
    var maxD = us ? toUS(maxCm, CM_PER_IN) : maxCm;
    var binWidth = (maxD - minD) / binCount;

    var cssW = 600, cssH = 200;
    var dpr = window.devicePixelRatio || 1;
    histCanvas.style.width = '100%';
    histCanvas.style.height = cssH + 'px';
    histCanvas.width = cssW * dpr;
    histCanvas.height = cssH * dpr;
    histCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    histCtx.clearRect(0, 0, cssW, cssH);

    var padL = 8, padR = 8, padT = 8, padB = 26;
    var plotW = cssW - padL - padR;
    var plotH = cssH - padT - padB;
    var barGap = 3;
    var barW = plotW / binCount - barGap;

    histCtx.strokeStyle = 'rgba(75,83,70,0.12)';
    histCtx.lineWidth = 1;
    for (var g = 0; g <= 3; g++) {
      var gy = padT + plotH * (g / 3);
      histCtx.beginPath();
      histCtx.moveTo(padL, gy);
      histCtx.lineTo(padL + plotW, gy);
      histCtx.stroke();
    }

    var bars = [];
    for (var i = 0; i < binCount; i++) {
      var h = maxCount > 0 ? (bins[i] / maxCount) * plotH : 0;
      var x = padL + i * (barW + barGap);
      var y = padT + plotH - h;
      histCtx.fillStyle = 'rgba(90,111,61,0.9)';
      histCtx.fillRect(x, y, Math.max(0, barW), h);
      bars.push({ x: x, y: y, w: barW, h: h, count: bins[i], loEdge: minD + i * binWidth, hiEdge: minD + (i + 1) * binWidth });
    }

    histCtx.strokeStyle = 'rgba(75,83,70,0.4)';
    histCtx.beginPath();
    histCtx.moveTo(padL, padT + plotH);
    histCtx.lineTo(padL + plotW, padT + plotH);
    histCtx.stroke();

    histCtx.fillStyle = 'rgba(75,83,70,0.9)';
    histCtx.font = '11px Inter, sans-serif';
    histCtx.textBaseline = 'top';
    var unitLabel = us ? ' in' : ' cm';
    histCtx.textAlign = 'left';
    histCtx.fillText(minD.toFixed(1) + unitLabel, padL, padT + plotH + 6);
    histCtx.textAlign = 'right';
    histCtx.fillText(maxD.toFixed(1) + unitLabel, padL + plotW, padT + plotH + 6);
    histCtx.textAlign = 'center';
    histCtx.fillText('DBH', padL + plotW / 2, padT + plotH + 6);

    histState = { bars: bars, us: us };
  }

  histCanvas.addEventListener('mousemove', function (e) {
    if (!histState) return;
    var rect = histCanvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var hit = null;
    for (var i = 0; i < histState.bars.length; i++) {
      var b = histState.bars[i];
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) { hit = b; break; }
    }
    if (hit) {
      histTooltipEl.textContent = hit.count + ' trees, ' + hit.loEdge.toFixed(1) + '–' + hit.hiEdge.toFixed(1) + (histState.us ? ' in' : ' cm');
      histTooltipEl.style.left = (hit.x + hit.w / 2) + 'px';
      histTooltipEl.style.top = hit.y + 'px';
      histTooltipEl.classList.add('is-visible');
    } else {
      histTooltipEl.classList.remove('is-visible');
    }
  });
  histCanvas.addEventListener('mouseleave', function () {
    histTooltipEl.classList.remove('is-visible');
  });

  function downloadCSV(csvText, filename) {
    var blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    generate();
  });

  function generate() {
    try {
      var us = isUS();

      var widthRaw = parseFloat(widthInput.value);
      var heightRaw = parseFloat(heightInput.value);
      var densityRaw = parseFloat(densityInput.value);
      var qmdRaw = parseFloat(qmdInput.value);
      var sdRaw = parseFloat(sdInput.value);

      var widthM = us ? toMetric(widthRaw, M_PER_FT) : widthRaw;
      var heightM = us ? toMetric(heightRaw, M_PER_FT) : heightRaw;
      var density = us ? toMetric(densityRaw, ACRES_PER_HA) : densityRaw;
      var qmd = us ? toMetric(qmdRaw, CM_PER_IN) : qmdRaw;
      var sd = us ? toMetric(sdRaw, CM_PER_IN) : sdRaw;

      if (!(widthM > 0) || !(heightM > 0) || !(density > 0) || !(qmd > 0) || !(sd >= 0)) {
        throw new Error('Please enter positive values for plot size, density, and QMD.');
      }

      var pattern = getPattern();

      var seedField = document.getElementById('sg-seed').value.trim();
      var seed = seedField === ''
        ? ((Date.now() ^ Math.floor(Math.random() * 0xFFFFFFFF)) >>> 0)
        : (parseInt(seedField, 10) >>> 0);
      var rng = mulberry32(seed);

      var params = {
        widthM: widthM, heightM: heightM, density: density, qmd: qmd, sd: sd,
        bimodal: parseFloat(document.getElementById('sg-bimodal-range').value) || 0,
        pLopsided: parseFloat(document.getElementById('sg-lopsided').value) / 100,
        pLeaning: parseFloat(document.getElementById('sg-leaning').value) / 100,
        pChlorosis: parseFloat(document.getElementById('sg-chlorosis').value) / 100,
        pFirescar: parseFloat(document.getElementById('sg-firescar').value) / 100,
        pCanker: parseFloat(document.getElementById('sg-canker').value) / 100,
        pSnag: parseFloat(document.getElementById('sg-snag').value) / 100
      };

      var result = pattern === 'grid' ? generateGrid(params, rng) : generateRandom(params, rng);
      var csv = buildCSV(result);

      var now = new Date();
      var dateStr = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());
      var timeStr = pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
      var suffix = pattern === 'grid' ? '_grid' : '';
      var filename = 'CustomMap_' + dateStr + '_' + timeStr + suffix + '.csv';

      lastCSV = csv;
      lastFilename = filename;
      downloadBtn.disabled = false;

      drawPreview(result, widthM, heightM);
      drawHistogram(result, us);

      var actualQmdMetric = Math.sqrt(mean(result.DBH.map(function (d) { return d * d; })));
      var actualSdMetric = stddev(result.DBH);

      var displayArea = us ? (result.areaHa * ACRES_PER_HA) : result.areaHa;
      var areaLabel = us ? 'acres' : 'ha';
      var displayQmd = us ? toUS(actualQmdMetric, CM_PER_IN) : actualQmdMetric;
      var displaySd = us ? toUS(actualSdMetric, CM_PER_IN) : actualSdMetric;
      var diamLabel = us ? 'in' : 'cm';
      var lengthLabel = us ? 'ft' : 'm';
      var perAreaLabel = us ? 'acre' : 'ha';

      var realizedDensity = result.n / displayArea;
      var baMetric = basalAreaPerHa(result);
      var baDisplay = us ? toUS(baMetric, BA_FACTOR) : baMetric;
      var baLabel = us ? 'ft²/acre' : 'm²/ha';

      summarySizeEl.textContent = displayArea.toFixed(1) + ' ' + areaLabel +
        ' (' + widthRaw.toFixed(1) + ' × ' + heightRaw.toFixed(1) + ' ' + lengthLabel + ')';
      summaryCountEl.textContent = result.n;
      summaryDensityEl.textContent = realizedDensity.toFixed(1) + ' / ' + perAreaLabel;
      summaryQmdEl.textContent = displayQmd.toFixed(1) + ' ' + diamLabel + ' ± ' + displaySd.toFixed(1);
      summaryBaEl.textContent = baDisplay.toFixed(1) + ' ' + baLabel;
      summarySeedEl.textContent = seed;

      resultsEl.classList.add('is-visible');
      statusEl.style.color = '';
      statusEl.textContent = '';
    } catch (err) {
      statusEl.style.color = '#b23a3a';
      statusEl.textContent = err.message;
    }
  }

  // The raw HTML defaults are authored in metric; if US units is the
  // checked default, bring the displayed numbers/labels in line with that
  // (this also computes the initial derived field as a side effect).
  // Otherwise just compute the initial derived field and tag it directly.
  if (isUS()) {
    applyUnitsDisplay();
  } else {
    updateDerived();
    drawDistributionPreview();
    updateAreaDisplay();
  }

  // Auto-generate an initial stand on load (using the default settings)
  // so visitors immediately see what this tool produces, without having
  // to click Generate first.
  generate();
})();
