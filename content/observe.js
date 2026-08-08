// MAIN-world network observer: the "the platform itself confirmed it" half of two-signal
// crediting. Runs in the PAGE's world (manifest "world": "MAIN") because the page's own
// fetch/XHR calls are the only place a platform's own confirmation of a repost or a send
// exists. It reports ONLY {platform, kind, ref, ok} to the isolated world: never
// credentials, never headers, never a response body, never anything beyond the post id
// that was matched out of the request the page itself sent.
//
// WHAT `ok` MEANS, exactly: the platform ACCEPTED the request (HTTP 2xx). It does NOT mean
// the platform carried it out. X's GraphQL answers a refused retweet (rate limited, tweet
// deleted, author suspended) with HTTP 200 and an errors[] array in the BODY, and reading
// that body here is forbidden by rule 2 below, it would consume the stream the page itself
// is about to read. So `ok` is one signal, never proof: the isolated world also requires
// the platform's own control to flip to its undo state before anything is credited.
//
// The isolated world holds the other half, the click intent. Neither signal credits alone.
// A console user can forge the postMessage, which puts a repost at the same trust tier as
// a like (client attested); honeypot targets and the server's repost burst sweep are the
// backstop. What this makes impossible is UI level faking: opening the repost menu and
// clicking nothing, which is the cheat that matters here.
//
// WHERE THIS RUNS: x.com and twitter.com only. Both manifests declare it on exactly the
// hosts a signature below already covers, because patching fetch and XHR on a host we have
// no signature for is pure blast radius for zero credit (and the hardest thing in this diff
// for a store reviewer to justify). The Task 11 discovery session widens the manifest match
// lists back to the TikTok and Instagram hosts in the SAME change that adds their entries to
// SIGS, never before. Manifests are strict JSON here (the release gate parses them), which
// is why that note lives in this file.
//
// HARD RULES. This code runs on x.com for real users, so a bug here does not merely fail to
// credit, it breaks THEIR web:
//   1. Always call through and return the original value untouched, on every path.
//   2. Never await, never delay, never modify a request or a response, never read a
//      response body (that would consume the stream and break the page).
//   3. Every piece of our own logic sits inside try/catch. Nothing we do may throw into
//      the page, including a signature matcher.
//   4. Wrap exactly once even if this script is injected twice (SPA navigation, or a
//      re-injection), guarded by a flag on window.
//   5. Touch the promise of a request ONLY when a signature already matched its URL, so
//      the millions of unrelated requests a page makes are left exactly as they were.
(function () {
  'use strict';
  try {
    if (window.__rgcObserve) return; // rule 4: exactly one wrap per window
    try {
      Object.defineProperty(window, '__rgcObserve', { value: 1, enumerable: false, writable: false, configurable: false });
    } catch (e) { window.__rgcObserve = 1; }

    // One entry per engagement mutation we credit.
    //   test(url, body) -> truthy when this request IS that mutation
    //   ref(url, body)  -> the post id, or null when it cannot be read (the isolated
    //                      world then falls back to the id it bound at click time)
    // kind is 'repost' or 'send'; the isolated world maps those to the server's
    // 'repost' and 'share_send' actions.
    var SIGS = [
      {
        platform: 'x', kind: 'repost',
        // POST https://x.com/i/api/graphql/<queryId>/CreateRetweet with a JSON body
        // carrying the tweet id. DeleteRetweet (the undo) deliberately does not match.
        test: function (url) { return /\/i\/api\/graphql\/[^/]+\/CreateRetweet(\b|$)/.test(String(url)); },
        ref: function (url, body) { var m = /"tweet_id"\s*:\s*"(\d+)"/.exec(String(body || '')); return m ? m[1] : null; },
      },
      {
        platform: 'tiktok', kind: 'repost',
        // POST https://www.tiktok.com/tiktok/v1/upvote/publish?...&item_id=<video id>
        // TikTok calls a repost an "upvote" internally, and puts the video id in the QUERY
        // string rather than the body. Recorded live 2026-08-08. The undo is a different
        // endpoint entirely (/upvote/delete), so it cannot match here: anchored on
        // /publish with an end boundary precisely so it never does.
        test: function (url) { return /\/tiktok\/v1\/upvote\/publish(\?|$)/.test(String(url)); },
        ref: function (url) {
          try { return new URL(String(url), location.origin).searchParams.get('item_id') || null; }
          catch (e) { return null; }
        },
      },
      // TODO(Instagram): repost or the paper plane media_share send, pending the live
      // discovery session. Until an entry exists, the matching action simply does not
      // credit on that platform: the isolated world never sees a confirmation, so the
      // widget row stays un-ticked and no request is sent. Absence is a missing feature,
      // never a broken page and never a credit nobody earned.
      //
      // DELIBERATELY ABSENT: TikTok's "send to friends". Recorded live 2026-08-08, the
      // send fires TikTok's own share_video_to_chat event but NO observable request
      // carries it: it goes out through their signed IM packet layer. Crediting it would
      // mean paying on a click alone, which is the exact hole the observer exists to
      // close, so sends do not earn on TikTok.
      // Whoever adds those entries: a test() must match ONE mutation endpoint exactly,
      // never a path prefix. Every request it matches gets its promise observed, and the
      // undo endpoint (un-repost) must not match at all. Add the matching hosts to the
      // observer's content_scripts entry in BOTH manifests in that same change (they were
      // narrowed to x.com and twitter.com precisely because no signature covers them yet),
      // and keep the two match lists identical or the release gate fails.
    ];

    // Give a wrapper the same name and arity as the function it replaces. Pages do read
    // fetch.name, and a wrapper that answers "wrappedFetch" is a needless difference from
    // the browser the member would otherwise have.
    function blendIn(fn, name, len) {
      try {
        Object.defineProperty(fn, 'name', { value: name, configurable: true });
        Object.defineProperty(fn, 'length', { value: len, configurable: true });
      } catch (e) { /* cosmetic only */ }
      return fn;
    }

    function matchSig(url, body) {
      for (var i = 0; i < SIGS.length; i++) {
        var s = SIGS[i];
        try { if (s.test(url, body)) return s; } catch (e) { /* one bad matcher never kills the rest */ }
      }
      return null;
    }

    function report(sig, url, body, ok) {
      try {
        var ref = null;
        try { ref = sig.ref(url, body) || null; } catch (e) { ref = null; }
        window.postMessage({ rgcObs: 1, platform: sig.platform, kind: sig.kind, ref: ref, ok: !!ok }, location.origin);
      } catch (e) { /* postMessage can throw on odd origins; crediting is optional, the page is not */ }
    }

    // --- fetch ---------------------------------------------------------------------
    var oFetch = window.fetch;
    if (typeof oFetch === 'function') {
      var wrappedFetch = function (input, init) {
        var url = '', body = '';
        // Read what we need BEFORE calling through, defensively: a getter on a Request
        // object could throw, and that must not stop the page's own call from happening.
        try {
          url = typeof input === 'string' ? input : (input && input.url) || '';
          body = (init && typeof init.body === 'string') ? init.body : '';
        } catch (e) { url = ''; body = ''; }
        // Call through first and return this exact promise, untouched, no matter what.
        var p = oFetch.apply(this, arguments);
        try {
          var sig = url ? matchSig(url, body) : null;
          if (sig && p && typeof p.then === 'function') {
            // Only a matched request's promise is ever observed (rule 5). res.ok is a
            // status flag, not the body; the body is never touched, so this reports
            // "accepted", not "done" (see WHAT `ok` MEANS at the top of this file).
            p.then(
              function (res) { report(sig, url, body, !!(res && res.ok)); },
              function () { /* the page's own request failed: nothing was confirmed */ }
            );
          }
        } catch (e) { /* observation is optional; the call already went through */ }
        return p;
      };
      try { window.fetch = blendIn(wrappedFetch, 'fetch', 1); } catch (e) { /* non-writable fetch: observe nothing, break nothing */ }
    }

    // --- XMLHttpRequest ------------------------------------------------------------
    var XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      var oOpen = XHR.prototype.open;
      var oSend = XHR.prototype.send;
      // The request url is remembered OUTSIDE the request object: a property on the
      // instance would be a page-visible mutation, and this way a sealed or proxied
      // XMLHttpRequest cannot make the assignment fail either.
      var xhrUrls = typeof WeakMap === 'function' ? new WeakMap() : null;
      if (typeof oOpen === 'function' && typeof oSend === 'function' && xhrUrls) {
        try {
          XHR.prototype.open = blendIn(function (method, url) {
            try { xhrUrls.set(this, String(url == null ? '' : url)); } catch (e) { /* observation is optional */ }
            return oOpen.apply(this, arguments);
          }, 'open', oOpen.length);
          XHR.prototype.send = blendIn(function (body) {
            var xhr = this;
            try {
              var u = '';
              try { u = xhrUrls.get(xhr) || ''; } catch (e) { u = ''; }
              var b = (typeof body === 'string') ? body : '';
              var sig = u ? matchSig(u, b) : null;
              // A listener is attached only to a matched request, and only reads status,
              // never responseText. Same meaning as the fetch path: 2xx says the platform
              // accepted the request, and the flipped control is what proves it happened.
              if (sig && typeof xhr.addEventListener === 'function') {
                xhr.addEventListener('loadend', function () {
                  var ok = false;
                  try { ok = xhr.status >= 200 && xhr.status < 300; } catch (e) { ok = false; }
                  report(sig, u, b, ok);
                });
              }
            } catch (e) { /* observation is optional; the send below still happens */ }
            return oSend.apply(this, arguments);
          }, 'send', oSend.length);
        } catch (e) { /* non-writable prototype: observe nothing, break nothing */ }
      }
    }
  } catch (e) { /* nothing in this file may escape into the page */ }
})();
