/*
 * Client-side system-status polling script.
 * Loaded inline by src/web/layout.ts via readFileSync. The exact same bytes
 * are also executed in tests/helpers/status-client-sandbox.ts so server-side
 * unit tests exercise the real script (no drift).
 *
 * Responsibilities:
 *   1. Poll GET /health every 10 seconds.
 *   2. Update the footer status dots to reflect each service's readiness.
 *   3. Wire the banner dismiss button so clicking it detaches the banner
 *      for the current page load only.
 *   4. On failed polls, retain the previously displayed state — never
 *      flash all indicators to not-ready on a transient network blip.
 */

(function () {
  "use strict";

  var POLL_INTERVAL_MS = 10000;
  var HEALTH_URL = "/health";

  function updateDot(service, ready) {
    var dot = document.getElementById("status-dot-" + service);
    if (!dot) return;
    if (ready) {
      dot.classList.remove("bg-destructive");
      dot.classList.add("bg-primary");
      dot.classList.add("animate-pulse");
    } else {
      dot.classList.remove("bg-primary");
      dot.classList.remove("animate-pulse");
      dot.classList.add("bg-destructive");
    }
  }

  function applyHealth(body) {
    if (!body || typeof body !== "object" || !body.services) return;
    var services = body.services;
    for (var key in services) {
      if (Object.prototype.hasOwnProperty.call(services, key)) {
        var entry = services[key];
        if (entry && typeof entry === "object") {
          updateDot(key, entry.ready === true);
        }
      }
    }
  }

  function poll() {
    try {
      fetch(HEALTH_URL, { headers: { Accept: "application/json" } })
        .then(function (res) {
          if (!res || !res.ok) {
            throw new Error("poll-failed");
          }
          return res.json();
        })
        .then(applyHealth)
        .catch(function () {
          /* Retain previous state on network or parse error. */
        });
    } catch (e) {
      /* Retain previous state on synchronous fetch error. */
    }
  }

  function wireDismiss() {
    var btn = document.getElementById("status-banner-dismiss");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var banner = document.getElementById("status-banner");
      if (!banner) return;
      if (banner.parentNode && typeof banner.parentNode.removeChild === "function") {
        banner.parentNode.removeChild(banner);
      } else if (typeof banner.remove === "function") {
        banner.remove();
      }
    });
  }

  function init() {
    wireDismiss();
    poll();
    setInterval(poll, POLL_INTERVAL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
