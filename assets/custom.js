(function () {
  function isLocalRoute() {
    return window.location.pathname.indexOf('/local') === 0;
  }

  function localLinkTarget() {
    var base = (window.PUBLIC_URL || '/').replace(/\/$/, '');
    return isLocalRoute() ? base + '/' : base + '/local';
  }

  function localLinkLabel() {
    return isLocalRoute() ? 'Study List' : 'Web Viewer';
  }

  function hideInvestigationalText() {
    var elements = document.querySelectorAll(
      '.notification-bar, .research-use, [class*="notification-bar"], [class*="research-use"]'
    );
    for (var i = 0; i < elements.length; i++) {
      elements[i].style.display = 'none';
    }
  }

  // The filter row gets a 12px gutter between boxes; the last cell is tagged so
  // its input can sit flush with the right edge. The column set changes with the
  // viewport (3 columns on narrow screens, 6 on wide ones, 1 for the card list),
  // so the tag is recomputed on every pass.
  function markLastFilterColumn() {
    var tables = document.querySelectorAll('.study-list-container table.table');
    for (var t = 0; t < tables.length; t++) {
      var headers = tables[t].querySelectorAll('thead th');
      var last = null;
      for (var i = 0; i < headers.length; i++) {
        headers[i].classList.remove('pacs-last');
        if (headers[i].getClientRects().length > 0) {
          last = headers[i];
        }
      }
      if (last) {
        last.classList.add('pacs-last');
      }
    }
  }

  // Column sets change with the viewport (3 columns on narrow screens,
  // 6 on wide ones), so placeholders and labels are keyed by filter id.
  var FILTER_PLACEHOLDERS = {
    'filter-patientNameOrId': 'Search patient name or MRN',
    'filter-PatientName': 'Search patient name',
    'filter-PatientID': 'Search MRN',
    'filter-AccessionNumber': 'Search accession #',
    'filter-modalities': 'Search modality',
    'filter-StudyDescription': 'Search description',
    'filter-accessionOrModalityOrDescription': 'Search accession, modality or description',
    'filter-allFields': 'Search name, MRN or accession'
  };

  function polishStudyList() {
    var inputs = document.querySelectorAll('.study-list-container .filters input');
    for (var i = 0; i < inputs.length; i++) {
      var placeholder = FILTER_PLACEHOLDERS[inputs[i].id];
      if (!placeholder) {
        // The card layout renders a single id-less search field.
        placeholder = inputs[i].id ? '' : 'Search studies';
      }
      if (placeholder && inputs[i].placeholder !== placeholder) {
        inputs[i].placeholder = placeholder;
      }
    }

    // In the narrow layout this column holds modality + accession, not a
    // description, so label it for what it shows.
    var labels = document.querySelectorAll('.study-list-container .filters label');
    for (var l = 0; l < labels.length; l++) {
      var label = labels[l];
      if (label.getAttribute('for') !== 'filter-accessionOrModalityOrDescription') {
        continue;
      }
      var textNode = label.firstChild;
      if (textNode && textNode.nodeType === 3 && textNode.nodeValue.indexOf('Description') === 0) {
        textNode.nodeValue = 'Modality / Accession';
      }
    }
  }

  // The list reserves a scrollbar gutter so the filter band, the rows and the
  // pagination share one right edge. Its width differs per browser (and per
  // scrollbar-width), so measure it and publish it as --sbw for the CSS.
  var lastScrollbarWidth = null;

  function syncScrollbarWidth() {
    var pane = document.querySelector('.study-list-container');
    if (!pane) {
      return;
    }

    var width = pane.offsetWidth - pane.clientWidth;
    if (width < 0) {
      width = 0;
    }
    if (width === lastScrollbarWidth) {
      return;
    }

    lastScrollbarWidth = width;
    document.documentElement.style.setProperty('--sbw', width + 'px');
  }

  function visibleHeaderMenu() {
    var menus = document.querySelectorAll('.header-menu');
    for (var i = 0; i < menus.length; i++) {
      if (menus[i].offsetWidth > 0 || menus[i].getClientRects().length > 0) {
        return menus[i];
      }
    }
    return null;
  }

  function ensureFallbackLink() {
    var fallback = document.querySelector('.custom-local-link-fallback');
    if (!fallback) {
      fallback = document.createElement('a');
      fallback.className = 'custom-local-link-fallback';
      fallback.addEventListener('click', function (event) {
        event.stopPropagation();
      });
      document.body.appendChild(fallback);
    }
    return fallback;
  }

  function updateLocalViewerLink() {
    if (!document.body) {
      return;
    }

    var menu = visibleHeaderMenu();
    var navLink = document.querySelector('.custom-local-link');

    if (menu) {
      if (!navLink) {
        navLink = document.createElement('a');
        navLink.className = 'custom-local-link';
        navLink.addEventListener('click', function (event) {
          event.stopPropagation();
        });
      }
      if (navLink.parentNode !== menu) {
        menu.insertBefore(navLink, menu.firstChild);
      }
      navLink.textContent = localLinkLabel();
      navLink.href = localLinkTarget();
      navLink.style.display = 'inline-flex';
    } else if (navLink && navLink.parentNode) {
      navLink.parentNode.removeChild(navLink);
    }

    var fallback = ensureFallbackLink();
    fallback.textContent = localLinkLabel();
    fallback.href = localLinkTarget();
    fallback.style.display = menu ? 'none' : 'inline-flex';
  }

  function update() {
    hideInvestigationalText();
    markLastFilterColumn();
    polishStudyList();
    updateLocalViewerLink();
    syncScrollbarWidth();
  }

  var pending = false;
  function scheduleUpdate() {
    if (pending) {
      return;
    }
    pending = true;
    window.requestAnimationFrame(function () {
      pending = false;
      update();
    });
  }

  if (document.documentElement) {
    new MutationObserver(scheduleUpdate).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', update);
  } else {
    update();
  }
  window.addEventListener('load', update);
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('popstate', scheduleUpdate);
})();
