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
// WHERE THIS RUNS: exactly the hosts a signature below already covers, currently x.com,
// twitter.com, the TikTok hosts and the Instagram hosts. Both manifests declare it on those
// and no others, because patching fetch and XHR on a host we have no signature for is pure
// blast radius for zero credit (and the hardest thing in this diff for a store reviewer to
// justify). A new platform's hosts join the observer's content_scripts match lists in the
// SAME change that adds its entry to SIGS, never before, and the two manifests stay identical.
// Manifests are strict JSON here (the release gate parses them), which is why that note lives
// in this file.
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
        platform: 'tiktok', kind: 'like',
        // POST /api/commit/item/digg/ fires only for a REAL like by a signed-in account:
        // signed-out heart clicks open the login sheet and never reach the network. type=1
        // is like, type=0 is the un-like and must not match. This makes TikTok likes
        // two-signal (owner, 2026-08-09: signed-out members were crediting likes the
        // platform never recorded).
        test: function (url) {
          var u = String(url);
          return /\/api\/commit\/item\/digg\/?\?/.test(u) && /[?&]type=1(&|$)/.test(u);
        },
        ref: function (url) { var m = /[?&]aweme_id=(\d+)/.exec(String(url)); return m ? m[1] : null; },
      },
      {
        platform: 'youtube', kind: 'comment',
        // POST https://www.youtube.com/youtubei/v1/comment/create_comment (and the reply
        // variant) fires for EVERY posted comment in every interface language and on every
        // markup variant, desktop and m.youtube alike. This is the language-proof comment
        // signal: the composer DOM selectors keep missing on localized / A-B layouts
        // (Serbian members, 2026-08-09, selector_health flooded with youtube composer
        // misses), but the network call cannot be renamed by a locale. The typed text
        // rides in the JSON body as "commentText", so the quality gate still applies.
        test: function (url) { return /\/youtubei\/v1\/comment\/create_comment(_reply)?(\b|\?|$)/.test(String(url)); },
        ref: function () { return null; },
        txt: function (url, body) {
          try {
            var m = /"commentText"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String(body || ''));
            if (!m) return null;
            return JSON.parse('"' + m[1] + '"');
          } catch (e) { return null; }
        },
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
      {
        platform: 'instagram', kind: 'repost',
        // POST to /graphql/query (and the confirm to /api/graphql) whose form-encoded body
        // carries fb_api_req_friendly_name=usePolarisCreateMediaRepostMutation. Recorded live
        // 2026-08-08. Anchored on the friendly-name in the BODY, not the path (it fires on
        // BOTH endpoints) and not the rotating doc_id. The un-repost is a DIFFERENT mutation
        // (usePolarisDeleteMediaRepostMutation), so it cannot match here.
        test: function (url, body) {
          return /(?:^|&)fb_api_req_friendly_name=usePolarisCreateMediaRepostMutation(?:&|$)/.test(String(body || ''));
        },
        // The mutation identifies the post by a NUMERIC media_id, not the instagram:<shortcode>
        // our targets use, and the two cannot be reconciled here. Return null: the isolated
        // world credits the post on screen via the armed click intent, the same null-ref path
        // the design already documents (see the ref() note above).
        ref: function () { return null; },
      },
      {
        platform: 'facebook', kind: 'like',
        // Comet's UFI react mutation fires for a like on posts AND reels, on every surface
        // and in every interface language. The PC reel action rail broke the DOM path
        // (2026-08-09: like control carries neither the English label nor aria-pressed
        // there), so likes credit off the wire instead. Body match on the friendly name,
        // like the repost signal below.
        test: function (url, body) {
          return /(?:^|&)fb_api_req_friendly_name=(?:CometUFIFeedbackReactMutation|useCometUFIFeedbackReactMutation)(?:&|$)/.test(String(body || ''));
        },
        ref: function () { return null; },
        // Reported 2026-08-13: a member opened a Facebook post and was credited the like
        // without liking it. This mutation pays with no click intent (facebook.js sets
        // likeNetworkPageScoped), so anything react-shaped on the page pays, and we do not
        // yet know what Facebook actually fired. This describes the mutation so the real
        // trigger can be identified from live traffic rather than guessed at, and the
        // matcher tightened precisely. Shapes only: the friendly name, whether a reaction
        // id is present and whether it is being set or cleared, and whether a feedback id
        // came along. No post content, no ids, nothing identifying.
        meta: function (url, body) {
          try {
            var b = String(body || '');
            var name = (b.match(/(?:^|&)fb_api_req_friendly_name=([^&]*)/) || [])[1] || '';
            var vars = (b.match(/(?:^|&)variables=([^&]*)/) || [])[1] || '';
            try { vars = decodeURIComponent(vars); } catch (e) { /* keep it raw */ }
            var reaction = (vars.match(/"feedback_reaction_id"\s*:\s*"?([0-9]+)"?/) || [])[1] || null;
            return {
              name: name,
              hasReaction: reaction != null,
              reactionSet: reaction != null && reaction !== '0',
              hasFeedbackId: /"feedback_id"\s*:/.test(vars),
              varsLen: vars.length,
            };
          } catch (e) { return null; }
        },
      },
      {
        platform: 'facebook', kind: 'repost',
        // FB's reshare ("Share now") posts a GraphQL mutation carrying
        // fb_api_req_friendly_name=ComposerStoryCreateMutation. Recorded live 2026-08-08.
        // Anchored on the friendly-name, not the path and not the rotating doc_id.
        //
        // Checked in the URL **and** the body: Comet sends this name in the query string on
        // some routes, and a body-only test could not see those at all (2026-08-16). Reshare
        // is create-only: there is no "un-reshare" mutation, so nothing to exclude here.
        test: function (url, body) {
          return /(?:[?&])fb_api_req_friendly_name=ComposerStoryCreateMutation(?:&|$)/.test(
            String(url || '') + '&' + String(body || ''));
        },
        // The mutation identifies the new story, not our numeric reel target, and the two
        // cannot be reconciled here. Return null: the isolated world credits the reel on screen
        // via the armed click intent (page-scoped, expires in 90s), like Instagram above.
        ref: function () { return null; },
      },
      {
        // DIAGNOSTIC, NOT A CREDIT. Reported 2026-08-13, and the numbers agree: 23 members
        // who reshare happily on TikTok and Instagram have never once earned a Facebook
        // repost, while it works for 95 others. Everything else was ruled out from data
        // first: the target, the hour, the extension version, the host list, the wrapped
        // transports, the share-affordance selector (missing at the same rate in both
        // groups) and every isolated-world gate. What is left is that their reshare fires
        // a mutation this list does not name, and Facebook has more than one way to
        // reshare (to feed, to a story, to a group, with commentary).
        //
        // Guessing the other names is exactly what the rule below forbids, and a wrong
        // guess here pays tickets for something that never spread the post. So this entry
        // records the NAME ONLY of share-shaped mutations that are not the one we credit,
        // the same way the reshare mutation itself was found on 2026-08-08.
        //
        // MUST stay after the repost entry: matchSig returns the FIRST match, so the real
        // one always wins and this can only ever see what that missed. kind is 'fbdiag',
        // which no crediting branch in engage-core reads, so it cannot pay anything.
        platform: 'facebook', kind: 'fbdiag',
        // Reads are EXCLUDED, and that is the point of this revision. Opening the composer
        // fires five *Query names in a burst (UnifiedShareSheet…, useFeedComposerCometMentions…),
        // which is more than the isolated world's per-page diagnostic budget: the budget was
        // spent before the member finished typing, so the create mutation this probe exists to
        // find could never be recorded. Every sample collected 2026-08-13..16 is a read query
        // for exactly that reason — the probe was starving itself, not proving Facebook hides
        // the create. Names ending in "Query" are therefore skipped here.
        //
        // Also matched against the URL, not just the body: Comet puts the friendly name in the
        // query string on some routes, which a body-only test cannot see at all.
        //
        // Last resort: a graphql POST carrying NO readable friendly name is recorded by SHAPE
        // only (the body's type), because "we cannot read this request at all" is itself the
        // answer if that is what is happening.
        test: function (url, body) {
          var u = String(url || '');
          var m = (u + '&' + String(body || '')).match(/(?:[?&])fb_api_req_friendly_name=([^&]*)/);
          if (m) {
            var n = m[1];
            if (n === 'ComposerStoryCreateMutation') return false; // credited above
            if (/Query$/i.test(n)) return false;                   // a read: never the create
            return true;
          }
          return /\/api\/graphql\//.test(u);
        },
        ref: function () { return null; },
        // The friendly name and nothing else. No post content, no ids, no body. When there is
        // no name, the body's TYPE only — never its contents.
        meta: function (url, body) {
          try {
            var n = ((String(url || '') + '&' + String(body || ''))
              .match(/(?:[?&])fb_api_req_friendly_name=([^&]*)/) || [])[1] || '';
            if (n) return { name: n.slice(0, 80) };
            var kind = body == null ? 'empty'
              : typeof body === 'string' ? 'string'
              : (typeof FormData !== 'undefined' && body instanceof FormData) ? 'formdata'
              : (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ? 'urlsearchparams'
              : (typeof Blob !== 'undefined' && body instanceof Blob) ? 'blob'
              : 'other';
            return { name: '(unnamed:' + kind + ')' };
          } catch (e) { return null; }
        },
      },
      // TODO(Instagram send): the paper plane media_share send, pending its own live
      // discovery session. Until an entry exists that action simply does not credit: the
      // isolated world never sees a confirmation, so the widget row stays un-ticked and no
      // request is sent. Absence is a missing feature, never a broken page and never a credit
      // nobody earned.
      //
      // DELIBERATELY ABSENT: TikTok's "send to friends". Recorded live 2026-08-08, the
      // send fires TikTok's own share_video_to_chat event but NO observable request
      // carries it: it goes out through their signed IM packet layer. Crediting it would
      // mean paying on a click alone, which is the exact hole the observer exists to
      // close, so sends do not earn on TikTok.
      // Whoever adds those entries: a test() must match ONE mutation exactly (a friendly-name
      // in the body or one endpoint), never a path prefix. Every request it matches gets its
      // promise observed, and the undo mutation (un-repost) must not match at all. Add the
      // matching hosts to the observer's content_scripts entry in BOTH manifests in that same
      // change, and keep the two match lists identical or the release gate fails.
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
        var txt = null;
        if (typeof sig.txt === 'function') { try { txt = sig.txt(url, body); } catch (e) { txt = null; } }
        var meta = null;
        if (typeof sig.meta === 'function') { try { meta = sig.meta(url, body); } catch (e) { meta = null; } }
        window.postMessage({ rgcObs: 1, platform: sig.platform, kind: sig.kind, ref: ref, ok: !!ok, txt: txt, meta: meta }, location.origin);
      } catch (e) { /* postMessage can throw on odd origins; crediting is optional, the page is not */ }
    }

    // Body text for the matchers, from every encoding a page may use.
    //
    // FormData used to read as EMPTY, and that is a crediting bug, not a cosmetic one: a
    // multipart submit is invisible to every signature below, so the mutation never
    // matches and the fbdiag probe cannot see it either. That is the exact shape of the
    // Facebook reshare cohort reported 2026-08-13 and again 2026-08-16 (members who
    // reshare fine on TikTok and Instagram, never once on Facebook, and whose probe rows
    // contain read queries only, never a create).
    //
    // ONLY the request-name fields are read, never the payload: the composer's text and
    // any attachment live in `variables`, and this file does not look at member content.
    // FormData.get() is synchronous and does not consume anything, unlike a Blob or a
    // stream, which stay unread exactly as before (rule 2).
    function bodyText(b) {
      try {
        if (b == null) return '';
        if (typeof b === 'string') return b;
        if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) return b.toString();
        if (typeof FormData !== 'undefined' && b instanceof FormData) {
          var out = '';
          var n = b.get('fb_api_req_friendly_name');
          if (typeof n === 'string' && n) out = 'fb_api_req_friendly_name=' + n;
          var d = b.get('doc_id');
          if (typeof d === 'string' && d) out += (out ? '&' : '') + 'doc_id=' + d;
          return out;
        }
      } catch (e) { /* an unreadable body observes as empty, exactly as it did before */ }
      return '';
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
          body = bodyText(init && init.body);
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

    // --- sendBeacon ----------------------------------------------------------------
    // Mobile web (m.youtube especially) fires some mutations through navigator.sendBeacon,
    // which the fetch and XHR taps never see. A Firefox-mobile member commented and nothing
    // credited (2026-08-10); this tap closes that path. String and URLSearchParams bodies
    // are readable synchronously; Blob bodies are skipped rather than consumed.
    try {
      var oBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
      if (oBeacon) {
        navigator.sendBeacon = function (url, data) {
          try {
            var body = bodyText(data);
            var sig = matchSig(String(url || ''), body);
            // sendBeacon gives no response to await: report on the boolean send result
            // below, which parallels fetch's "accepted, not done" semantics closely enough
            // for a mutation that only fires on a real user action.
            if (sig) {
              var sent = oBeacon(url, data);
              report(sig, String(url || ''), body, sent !== false);
              return sent;
            }
          } catch (e) { /* observing must never break the page */ }
          return oBeacon(url, data);
        };
      }
    } catch (e) { /* ignore */ }

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
              var b = bodyText(body);
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
