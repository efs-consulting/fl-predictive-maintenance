'use strict';

// ──────────────────────────────────────────────────────────────────────────────
//  BearingFL — Shared tooltip controller
//  Supports:  data-tooltip        (body text)
//             data-tooltip-title  (optional bold heading)
//  Usage: add either attribute to any element; tooltip appears above on hover.
// ──────────────────────────────────────────────────────────────────────────────

(function () {
  var box   = document.getElementById('fl-tooltip');
  var arrow = document.getElementById('fl-tooltip-arrow');
  var timer = null, cx = 0, cy = 0;
  var activeEl = null;
  var aw = 0, ah = 0;  // arrow dimensions, read lazily on first show

  if (!box) return;  // safety — guard if element missing

  document.addEventListener('mousemove', function (e) { cx = e.clientX; cy = e.clientY; });

  function _readArrowSize() {
    if (!aw && arrow) {
      // border-triangle: offsetWidth = borderLeft + borderRight, offsetHeight = borderTop
      aw = arrow.offsetWidth  || 12;
      ah = arrow.offsetHeight || 7;
    }
  }

  function position() {
    _readArrowSize();
    var bw = box.offsetWidth, bh = box.offsetHeight;
    var m  = 10;
    var top  = cy - bh - ah - 14;
    var left = cx - Math.round(bw / 2);

    // Flip below cursor if not enough room above
    var below = false;
    if (top < m) { top = cy + 20; below = true; }

    // Clamp horizontally
    if (left + bw > window.innerWidth  - m) left = window.innerWidth  - bw - m;
    if (left < m) left = m;
    // Clamp vertically
    if (top + bh > window.innerHeight - m) top = window.innerHeight - bh - m;
    if (top < m) top = m;

    box.style.left = left + 'px';
    box.style.top  = top  + 'px';

    // Position arrow: centred on cursor relative to box
    if (arrow) {
      var arrowLeft = cx - left - Math.round(aw / 2);
      arrowLeft = Math.max(12, Math.min(bw - 12 - aw, arrowLeft));
      arrow.style.left = arrowLeft + 'px';
      if (below) {
        arrow.style.top    = (-ah) + 'px';
        arrow.style.bottom = 'auto';
        arrow.style.transform = 'rotate(180deg)';
      } else {
        arrow.style.bottom = (-ah) + 'px';
        arrow.style.top    = 'auto';
        arrow.style.transform = '';
      }
    }
  }

  function show(el) {
    var title = el.getAttribute('data-tooltip-title') || '';
    var body  = el.getAttribute('data-tooltip')       || '';
    if (!title && !body) return;

    // Build content — clear text nodes but keep arrow reference alive
    box.innerHTML = '';
    if (title) {
      var t = document.createElement('div');
      t.className   = 'tt-title';
      t.textContent = title;
      box.appendChild(t);
    }
    if (body) {
      var b = document.createElement('div');
      b.className   = title ? 'tt-body' : 'tt-body tt-body-only';
      b.textContent = body;
      box.appendChild(b);
    }
    // Re-attach arrow (innerHTML cleared it from DOM but variable still holds ref)
    if (arrow) box.appendChild(arrow);

    box.classList.add('tt-visible');
    position();
  }

  function hide() {
    clearTimeout(timer);
    box.classList.remove('tt-visible');
    activeEl = null;
  }

  document.addEventListener('mousemove', function () {
    if (box.classList.contains('tt-visible')) position();
  });

  document.addEventListener('mouseover', function (e) {
    var el   = e.target.closest('[data-tooltip],[data-tooltip-title]');
    var prev = e.relatedTarget ? e.relatedTarget.closest('[data-tooltip],[data-tooltip-title]') : null;
    if (el === prev) return;
    clearTimeout(timer);
    box.classList.remove('tt-visible');
    if (el) {
      activeEl = el;
      timer = setTimeout(function () { if (activeEl === el) show(el); }, 280);
    }
  });

  document.addEventListener('mouseout', function (e) {
    var el   = e.target.closest('[data-tooltip],[data-tooltip-title]');
    var next = e.relatedTarget ? e.relatedTarget.closest('[data-tooltip],[data-tooltip-title]') : null;
    if (el === next) return;
    hide();
  });

  // Hide on scroll or click
  document.addEventListener('scroll',   hide, true);
  document.addEventListener('mousedown', hide, true);
})();
