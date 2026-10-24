(function () {
  'use strict';
  try {
    if (window.__rgcObserve) return;
    try {
      Object.defineProperty(window, '__rgcObserve', { value: 1, enumerable: false, writable: false, configurable: false });
    } catch (e) { window.__rgcObserve = 1; }

    function friendlyName(url, body) {
      var hay = String(url || '') + '&' + String(body || '');
      var m = hay.match(/(?:[?&])fb_api_req_friendly_name=([^&]*)/);
      if (m) return m[1];
      m = hay.match(/"fb_api_req_friendly_name"\s*:\s*"([^"]+)"/);
      if (m) return m[1];
      m = hay.match(/\\"fb_api_req_friendly_name\\"\s*:\s*\\"([^\\"]+)\\"/);
      if (m) return m[1];
      if (hay.indexOf('%22fb_api_req_friendly_name%22') !== -1 || hay.indexOf('fb_api_req_friendly_name%3D') !== -1) {
        try {
          var dec = decodeURIComponent(hay);
          m = dec.match(/(?:[?&])fb_api_req_friendly_name=([^&]*)/)
            || dec.match(/"fb_api_req_friendly_name"\s*:\s*"([^"]+)"/);
          if (m) return m[1];
        } catch (e) {   }
      }
      return '';
    }

    var SIGS = [
      {
        platform: 'x', kind: 'repost',
        test: function (url) { return /\/i\/api\/graphql\/[^/]+\/CreateRetweet(\b|$)/.test(String(url)); },
        ref: function (url, body) { var m = /"tweet_id"\s*:\s*"(\d+)"/.exec(String(body || '')); return m ? m[1] : null; },
      },
      {
        platform: 'tiktok', kind: 'like',
        test: function (url) {
          var u = String(url);
          return /\/api\/commit\/item\/digg\/?\?/.test(u) && /[?&]type=[01](&|$)/.test(u);
        },
        ref: function (url) { var m = /[?&]aweme_id=(\d+)/.exec(String(url)); return m ? m[1] : null; },
      },
      {
        platform: 'youtube', kind: 'comment',
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
        platform: 'youtube', kind: 'comment_action',
        test: function (url) { return /\/youtubei\/v1\/comment\/perform_comment_action(\b|\?|$)/.test(String(url)); },
        ref: function () { return null; },
      },
      {
        platform: 'tiktok', kind: 'comment',
        test: function (url) { return /\/api\/comment\/publish\/?(\?|$)/.test(String(url)); },
        ref: function (url, body) {
          var m = /[?&]aweme_id=(\d+)/.exec(String(url)) || /(?:^|&)aweme_id=(\d+)/.exec(String(body || ''));
          return m ? m[1] : null;
        },
        txt: function (url, body) {
          var m = /[?&]text=([^&]*)/.exec(String(url)) || /(?:^|&)text=([^&]*)/.exec(String(body || ''));
          if (!m) return null;
          try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return null; }
        },
      },
      {
        platform: 'tiktok', kind: 'comment_like',
        test: function (url, body) {
          var u = String(url);
          if (!/\/api\/comment\/digg\/?(\?|$)/.test(u)) return false;
          return /[?&]digg_type=[12](&|$)/.test(u) || /(?:^|&)digg_type=[12](&|$)/.test(String(body || ''));
        },
        ref: function (url, body) {
          var m = /[?&]aweme_id=(\d+)/.exec(String(url)) || /(?:^|&)aweme_id=(\d+)/.exec(String(body || ''));
          return m ? m[1] : null;
        },
        meta: function (url, body) {
          var m = /[?&]cid=(\d+)/.exec(String(url)) || /(?:^|&)cid=(\d+)/.exec(String(body || ''));
          return m ? { commentId: m[1] } : null;
        },
      },
      {
        platform: 'tiktok', kind: 'repost',
        test: function (url) { return /\/tiktok\/v1\/upvote\/publish(\?|$)/.test(String(url)); },
        ref: function (url) {
          try { return new URL(String(url), location.origin).searchParams.get('item_id') || null; }
          catch (e) { return null; }
        },
      },
      {
        platform: 'instagram', kind: 'repost',
        test: function (url, body) {
          return friendlyName(url, body) === 'usePolarisCreateMediaRepostMutation';
        },
        ref: function () { return null; },
      },
      {
        platform: 'facebook', kind: 'like',
        test: function (url, body) {
          var n = friendlyName(url, body);
          return n === 'CometUFIFeedbackReactMutation' || n === 'useCometUFIFeedbackReactMutation';
        },
        ref: function () { return null; },
        meta: function (url, body) {
          try {
            var b = String(body || '');
            var name = (b.match(/(?:^|&)fb_api_req_friendly_name=([^&]*)/) || [])[1] || '';
            var vars = (b.match(/(?:^|&)variables=([^&]*)/) || [])[1] || '';
            try { vars = decodeURIComponent(vars); } catch (e) {   }
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
        test: function (url, body) {
          return friendlyName(url, body) === 'ComposerStoryCreateMutation';
        },
        ref: function () { return null; },
      },
      {
        platform: 'facebook', kind: 'fbdiag',
        test: function (url, body) {
          var u = String(url || '');
          var n0 = friendlyName(u, body);
          if (n0) {
            var n = n0;
            if (n === 'ComposerStoryCreateMutation') return false;
            if (/Query$/i.test(n)) return false;
            return true;
          }
          return /\/api\/graphql\//.test(u);
        },
        ref: function () { return null; },
        meta: function (url, body) {
          try {
            var n = friendlyName(url, body);
            if (n) return { name: n.slice(0, 80) };
            var kind = body == null ? 'empty'
              : typeof body === 'string' ? 'string'
              : (typeof FormData !== 'undefined' && body instanceof FormData) ? 'formdata'
              : (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ? 'urlsearchparams'
              : (typeof Blob !== 'undefined' && body instanceof Blob) ? 'blob'
              : 'other';
            var str = typeof body === 'string' ? body : '';
            var path = '';
            try { path = String(url || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 80); } catch (e) { path = ''; }
            var keys = '';
            try {
              if (str && !/^\s*[{[]/.test(str) && str.indexOf('=') !== -1) {
                keys = str.split('&').slice(0, 12)
                  .map(function (kv) { return kv.split('=')[0]; })
                  .filter(function (k) { return k && k.length < 40 && /^[A-Za-z0-9_.[\]-]+$/.test(k); })
                  .join(',').slice(0, 200);
              }
            } catch (e) { keys = ''; }
            return {
              name: '(unnamed:' + kind + ')',
              looksJson: /^\s*[{[]/.test(str),
              hasNameToken: str.indexOf('fb_api_req_friendly_name') !== -1,
              path: path,
              keys: keys,
            };
          } catch (e) { return null; }
        },
      },
    ];

    function blendIn(fn, name, len) {
      try {
        Object.defineProperty(fn, 'name', { value: name, configurable: true });
        Object.defineProperty(fn, 'length', { value: len, configurable: true });
      } catch (e) {   }
      return fn;
    }

    var fbmSent = 0, FBM_MAX = 30, fbmTapAt = 0;
    function fbMobile() {
      var h = String(location.hostname || '');
      if (!/(^|\.)facebook\.com$/.test(h)) return false;
      return /^(m|mobile|touch|mbasic)\./.test(h) || /Android|iPhone|Mobile/i.test(String(navigator.userAgent || ''));
    }
    try {
      if (fbMobile()) {
        document.addEventListener('pointerdown', function () { fbmTapAt = Date.now(); }, true);
        document.addEventListener('touchstart', function () { fbmTapAt = Date.now(); }, { capture: true, passive: true });
      }
    } catch (e) {   }
    function probeFbMobile(url, body) {
      try {
        if (fbmSent >= FBM_MAX || !fbMobile()) return;
        if (Date.now() - fbmTapAt > 20000) return;
        if (body == null || body === '') return;
        var u = String(url || '');
        var path = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 100);
        var b = typeof body === 'string' ? body : '';
        var keys = [];
        try { if (b && b.indexOf('=') > 0 && b.charAt(0) !== '{') new URLSearchParams(b).forEach(function (v, k) { if (keys.indexOf(k) < 0 && keys.length < 30) keys.push(k.slice(0, 40)); }); } catch (e) {   }
        var name = '';
        try { name = (friendlyName(u, b) || '').slice(0, 80); } catch (e) { name = ''; }
        fbmSent++;
        window.postMessage({ rgcObs: 1, platform: 'facebook', kind: 'fbmdiag', ref: null, ok: true, txt: null,
          meta: { path: path, name: name, keys: keys.join(','), json: b.charAt(0) === '{', host: String(location.hostname || '').slice(0, 40) } }, location.origin);
      } catch (e) {   }
    }

    var ttNetSent = 0, TT_NET_MAX = 10, TT_NET_WINDOW = 4000, ttTapAt = 0;
    var ttHdrs = typeof WeakMap === 'function' ? new WeakMap() : null;
    function ttHost() { return /(^|\.)tiktok\.com$/.test(String(location.hostname || '')); }
    try {
      if (ttHost()) {
        document.addEventListener('pointerdown', function () { ttTapAt = Date.now(); }, true);
        document.addEventListener('touchstart', function () { ttTapAt = Date.now(); }, { capture: true, passive: true });
      }
    } catch (e) {   }
    function ttNetWanted(url, method) {
      try {
        if (ttNetSent >= TT_NET_MAX || !ttHost()) return false;
        var m = String(method || 'GET').toUpperCase();
        if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
        var path = String(url || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        if (/\/digg\/?$/.test(path)) return true;
        return !!ttTapAt && Date.now() - ttTapAt <= TT_NET_WINDOW;
      } catch (e) { return false; }
    }
    function headerNames(h) {
      var out = [];
      try {
        if (!h) return out;
        if (typeof Headers !== 'undefined' && h instanceof Headers) h.forEach(function (v, k) { if (out.length < 25) out.push(String(k).slice(0, 40).toLowerCase()); });
        else if (Array.isArray(h)) h.forEach(function (p) { if (p && out.length < 25) out.push(String(p[0]).slice(0, 40).toLowerCase()); });
        else if (typeof h === 'object') Object.keys(h).forEach(function (k) { if (out.length < 25) out.push(String(k).slice(0, 40).toLowerCase()); });
      } catch (e) {   }
      return out;
    }
    function probeTtNet(transport, method, url, shape, hdrs) {
      try {
        if (ttNetSent >= TT_NET_MAX) return;
        var u = String(url || '');
        var path = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 80);
        var qkeys = [], qflag = null;
        try {
          new URL(u, location.origin).searchParams.forEach(function (v, k) {
            if (qkeys.indexOf(k) < 0 && qkeys.length < 40) qkeys.push(String(k).slice(0, 40));
            if ((k === 'type' || k === 'digg_type') && /^[A-Za-z0-9_-]{1,6}$/.test(String(v))) qflag = k + '=' + v;
          });
        } catch (e) {   }
        ttNetSent++;
        window.postMessage({ rgcObs: 1, platform: 'tiktok', kind: 'ttnetdiag', ref: null, ok: true, txt: null,
          meta: { tr: transport, m: String(method || '').toUpperCase().slice(0, 8), p: path,
                  dt: ttTapAt ? Math.min(99999, Date.now() - ttTapAt) : null, ul: u.length,
                  qk: qkeys.join(','), qf: qflag, hk: (hdrs || []).join(','),
                  bs: shape.shape, bk: shape.keys.join(','), bf: shape.flag } }, location.origin);
      } catch (e) {   }
    }
    function probeTtNetRequest(copy, url, method, hdrs) {
      try {
        copy.text().then(function (t) {
          var s = String(t || '').length > 8192 ? { shape: 'big', keys: [], flag: null } : bodyShape(t, null);
          if (s.shape !== 'big') s.shape = 'request:' + s.shape;
          probeTtNet('fetch', method, url, s, hdrs);
        }, function () { probeTtNet('fetch', method, url, { shape: 'request:unreadable', keys: [], flag: null }, hdrs); });
      } catch (e) {   }
    }

    var ttProbeSent = 0, TT_PROBE_MAX = 4;
    function probeUnmatched(url) {
      try {
        if (ttProbeSent >= TT_PROBE_MAX) return;
        if (!/(^|\.)tiktok\.com$/.test(String(location.hostname || ''))) return;
        var u = String(url || '');
        var path = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        if (path.indexOf('/comment/') === -1 || path.indexOf('/comment/list') !== -1) return;
        ttProbeSent++;
        window.postMessage({ rgcObs: 1, platform: 'tiktok', kind: 'ttdiag', ref: null, ok: true, txt: null, meta: { path: path.slice(0, 80) } }, location.origin);
      } catch (e) {   }
    }

    var ttDiggSent = 0, TT_DIGG_MAX = 6;
    function bodyShape(raw, input) {
      var shape = 'none', keys = [], flag = null;
      var addKey = function (k) { if (keys.indexOf(k) < 0 && keys.length < 30) keys.push(String(k).slice(0, 40)); };
      var noteFlag = function (k, v) { if ((k === 'type' || k === 'digg_type') && /^[A-Za-z0-9_-]{1,6}$/.test(String(v))) flag = k + '=' + String(v); };
      try {
        if (raw == null && typeof Request !== 'undefined' && input instanceof Request) shape = 'request-' + String(input.method || '').toLowerCase();
        else if (raw == null) shape = 'none';
        else if (typeof raw === 'string') {
          var t = raw.trim();
          if (t.charAt(0) === '{') {
            shape = 'json';
            try { var o = JSON.parse(t); if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { addKey(k); noteFlag(k, o[k]); }); } catch (e) {   }
          } else if (t.indexOf('=') > 0) {
            shape = 'form';
            try { new URLSearchParams(t).forEach(function (v, k) { addKey(k); noteFlag(k, v); }); } catch (e) {   }
          } else shape = t ? 'string' : 'empty';
        }
        else if (typeof URLSearchParams !== 'undefined' && raw instanceof URLSearchParams) { shape = 'urlsearchparams'; raw.forEach(function (v, k) { addKey(k); noteFlag(k, v); }); }
        else if (typeof FormData !== 'undefined' && raw instanceof FormData) { shape = 'formdata'; raw.forEach(function (v, k) { addKey(k); if (typeof v === 'string') noteFlag(k, v); }); }
        else if (typeof Blob !== 'undefined' && raw instanceof Blob) shape = 'blob';
        else if (typeof ArrayBuffer !== 'undefined' && raw instanceof ArrayBuffer) shape = 'arraybuffer';
        else if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(raw)) shape = 'typedarray';
        else if (typeof ReadableStream !== 'undefined' && raw instanceof ReadableStream) shape = 'stream';
        else shape = 'other';
      } catch (e) { shape = 'unreadable'; }
      return { shape: shape, keys: keys, flag: flag };
    }
    function probeTtDigg(url, raw, input, method) {
      try {
        if (ttDiggSent >= TT_DIGG_MAX) return;
        if (!/(^|\.)tiktok\.com$/.test(String(location.hostname || ''))) return;
        var u = String(url || '');
        var path = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        if (!/\/digg\/?$/.test(path)) return;
        var qkeys = [], qflag = null;
        try {
          new URL(u, location.origin).searchParams.forEach(function (v, k) {
            if (qkeys.indexOf(k) < 0 && qkeys.length < 40) qkeys.push(String(k).slice(0, 40));
            if ((k === 'type' || k === 'digg_type') && /^[A-Za-z0-9_-]{1,6}$/.test(String(v))) qflag = k + '=' + v;
          });
        } catch (e) {   }
        var b = bodyShape(raw, input);
        ttDiggSent++;
        window.postMessage({ rgcObs: 1, platform: 'tiktok', kind: 'ttdiggdiag', ref: null, ok: true, txt: null,
          meta: { path: path.slice(0, 80), method: String(method || '').toUpperCase().slice(0, 8), qkeys: qkeys.join(','), qflag: qflag,
                  body: b.shape, bkeys: b.keys.join(','), bflag: b.flag } }, location.origin);
      } catch (e) {   }
    }

    var TT_BODY_MAX = 2 * 1024 * 1024, TT_CIDS_MAX = 50;
    var ttStore = Object.create(null), ttStoreN = 0;
    function onTikTokHost() { return /(^|\.)tiktok\.com$/.test(String(location.hostname || '')); }
    function ttLikedKind(url, method) {
      try {
        if (!onTikTokHost()) return null;
        if (method && String(method).toUpperCase() !== 'GET') return null;
        var path = String(url || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0].split('#')[0];
        if (/^\/api\/item\/detail\/?$/.test(path)) return 'detail';
        if (/^\/api\/comment\/list\/?$/.test(path)) return 'comments';
      } catch (e) {   }
      return null;
    }
    var idOk = function (v) { return (typeof v === 'string' || typeof v === 'number') && /^\d{5,30}$/.test(String(v)); };
    function parseTtLiked(kind, text, url) {
      try {
        if (typeof text !== 'string' || !text || text.length > TT_BODY_MAX) return null;
        var j = JSON.parse(text);
        if (!j || typeof j !== 'object') return null;
        if (kind === 'detail' || kind === 'rehydrate') {
          var it = null;
          if (kind === 'detail') it = j.itemInfo && j.itemInfo.itemStruct;
          else {
            var sc = j.__DEFAULT_SCOPE__ && j.__DEFAULT_SCOPE__['webapp.video-detail'];
            it = sc && sc.itemInfo && sc.itemInfo.itemStruct;
          }
          if (!it || typeof it !== 'object' || !idOk(it.id)) return null;
          var has = Object.prototype.hasOwnProperty.call(it, 'digged');
          return { ref: String(it.id), liked: has ? it.digged === true || it.digged === 1 : null, cids: [],
                   found: { digged: has, userDigged: false } };
        }
        if (kind === 'comments') {
          var list = j.comments;
          if (!Array.isArray(list)) return null;
          var ref = null;
          try { ref = new URL(String(url || ''), location.origin).searchParams.get('aweme_id'); } catch (e) { ref = null; }
          var cids = [], anyFlag = false;
          for (var i = 0; i < list.length && i < 500; i++) {
            var c = list[i];
            if (!c || typeof c !== 'object') continue;
            if (!idOk(ref) && idOk(c.aweme_id)) ref = String(c.aweme_id);
            if (idOk(c.aweme_id) && idOk(ref) && String(c.aweme_id) !== String(ref)) continue;
            if (Object.prototype.hasOwnProperty.call(c, 'user_digged')) anyFlag = true;
            if ((c.user_digged === 1 || c.user_digged === true) && idOk(c.cid) && cids.length < TT_CIDS_MAX
                && cids.indexOf(String(c.cid)) < 0) cids.push(String(c.cid));
          }
          if (!idOk(ref)) return null;
          return { ref: String(ref), liked: null, cids: cids, found: { digged: false, userDigged: anyFlag } };
        }
      } catch (e) {   }
      return null;
    }
    function postTtLiked(res, src) {
      try {
        if (!res) return;
        var s = ttStore[res.ref];
        if (!s) {
          if (ttStoreN >= 200) return;
          s = ttStore[res.ref] = { liked: null, cids: [], found: { digged: false, userDigged: false } };
          ttStoreN++;
        }
        if (res.liked === true) s.liked = true; else if (res.liked === false && s.liked == null) s.liked = false;
        for (var i = 0; i < res.cids.length; i++) if (s.cids.indexOf(res.cids[i]) < 0 && s.cids.length < TT_CIDS_MAX) s.cids.push(res.cids[i]);
        if (res.found.digged) s.found.digged = true;
        if (res.found.userDigged) s.found.userDigged = true;
        window.postMessage({ rgcObs: 1, platform: 'tiktok', kind: 'ttliked', ref: res.ref, ok: true, txt: null,
          meta: { src: src, liked: res.liked, cids: res.cids.slice(0, TT_CIDS_MAX),
                  found: { digged: !!res.found.digged, userDigged: !!res.found.userDigged } } }, location.origin);
      } catch (e) {   }
    }
    function readTtFetch(p, kind, url) {
      try {
        if (!p || typeof p.then !== 'function') return;
        p.then(function (res) {
          try {
            if (!res || !res.ok || typeof res.clone !== 'function') return;
            var len = 0;
            try { len = Number(res.headers && res.headers.get && res.headers.get('content-length')) || 0; } catch (e) { len = 0; }
            if (len > TT_BODY_MAX) return;
            var copy = res.clone();
            copy.text().then(function (t) { postTtLiked(parseTtLiked(kind, t, url), kind); }, function () {   });
          } catch (e) {   }
        }, function () {   });
      } catch (e) {   }
    }
    function readTtXhr(xhr, kind, url) {
      try {
        xhr.addEventListener('load', function () {
          try {
            if (!(xhr.status >= 200 && xhr.status < 300)) return;
            var rt = xhr.responseType;
            if (rt !== '' && rt !== 'text') return;
            postTtLiked(parseTtLiked(kind, xhr.responseText, url), kind);
          } catch (e) {   }
        });
      } catch (e) {   }
    }
    var ttRehydrated = false;
    function readTtRehydration() {
      try {
        if (ttRehydrated || !onTikTokHost()) return;
        ttRehydrated = true;
        var el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
        var t = el && el.textContent;
        if (typeof t === 'string' && t.length <= TT_BODY_MAX) postTtLiked(parseTtLiked('rehydrate', t, ''), 'rehydrate');
      } catch (e) {   }
    }
    try {
      window.addEventListener('message', function (e) {
        try {
          if (e.source !== window || !e.data || e.data.rgcObsPing !== 1) return;
          window.postMessage({ rgcObsHello: 1 }, location.origin);
        } catch (err) {   }
      });
    } catch (e) {   }
    try {
      if (onTikTokHost() && typeof document !== 'undefined' && document) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', readTtRehydration, { once: true });
        else readTtRehydration();
        window.addEventListener('message', function (e) {
          try {
            if (e.source !== window || !e.data || e.data.rgcObsAsk !== 1 || e.data.kind !== 'ttliked') return;
            var want = String(e.data.ref || '');
            var s = ttStore[want];
            if (!s) return;
            postTtLiked({ ref: want, liked: s.liked, cids: s.cids.slice(), found: s.found }, 'ask');
          } catch (e2) {   }
        });
      }
    } catch (e) {   }

    function matchSig(url, body) {
      for (var i = 0; i < SIGS.length; i++) {
        var s = SIGS[i];
        try { if (s.test(url, body)) return s; } catch (e) {   }
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
      } catch (e) {   }
    }

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
      } catch (e) {   }
      return '';
    }

    function bytesText(buf) {
      try {
        var u = new Uint8Array(buf);
        if (u.length > 2 && u[0] === 0x1f && u[1] === 0x8b) {
          if (typeof DecompressionStream !== 'function' || typeof Response !== 'function' || typeof Blob !== 'function') {
            return Promise.resolve('');
          }
          return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip')))
            .text().then(function (t) { return typeof t === 'string' ? t : ''; }, function () { return ''; });
        }
        return Promise.resolve(typeof TextDecoder === 'function' ? new TextDecoder().decode(u) : '');
      } catch (e) { return Promise.resolve(''); }
    }
    function binaryBody(b) {
      try {
        if (b == null || typeof b === 'string') return null;
        if (typeof ArrayBuffer !== 'undefined' && (b instanceof ArrayBuffer || ArrayBuffer.isView(b))) {
          var view = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
          return bytesText(view.slice());
        }
        if (typeof Blob !== 'undefined' && b instanceof Blob) {
          return b.slice().arrayBuffer().then(bytesText, function () { return ''; });
        }
      } catch (e) {   }
      return null;
    }

    var oFetch = window.fetch;
    if (typeof oFetch === 'function') {
      var wrappedFetch = function (input, init) {
        var url = '', body = '', reqCopy = null, bodyP = null;
        try {
          url = typeof input === 'string' ? input : (input && input.url) || '';
          body = bodyText(init && init.body);
          if (!body && !(init && init.body != null) && typeof Request !== 'undefined'
              && input instanceof Request && input.method !== 'GET' && input.method !== 'HEAD'
              && url && matchSig(url, '')) {
            reqCopy = input.clone();
          }
          if (!body && !reqCopy && init && init.body != null && url && matchSig(url, '')) {
            bodyP = binaryBody(init.body);
          }
        } catch (e) { url = ''; body = ''; reqCopy = null; bodyP = null; }
        var netCopy = null, netShape = null, netMeth = 'GET', netHdrs = null;
        try {
          var isReq = typeof Request !== 'undefined' && input instanceof Request;
          netMeth = (init && init.method) || (isReq ? input.method : 'GET');
          if (url && ttNetWanted(url, netMeth)) {
            netHdrs = headerNames((init && init.headers) || (isReq ? input.headers : null));
            if (isReq && !(init && init.body != null)) netCopy = input.clone();
            else netShape = bodyShape(init && init.body, null);
          }
        } catch (e) { netCopy = null; netShape = null; }
        var p = oFetch.apply(this, arguments);
        try {
          if (netCopy) probeTtNetRequest(netCopy, url, netMeth, netHdrs);
          else if (netShape) probeTtNet('fetch', netMeth, url, netShape, netHdrs);
        } catch (e) {   }
        if (reqCopy || bodyP) {
          try {
            var textP = bodyP || reqCopy.arrayBuffer().then(bytesText, function () { return ''; });
            if (p && typeof p.then === 'function') {
              p.then(function (res) {
                textP.then(function (t) {
                  try {
                    var sig2 = matchSig(url, t);
                    if (sig2) report(sig2, url, t, !!(res && res.ok));
                  } catch (e) {   }
                });
              }, function () {   });
            }
          } catch (e) {   }
          return p;
        }
        try {
          var sig = url ? matchSig(url, body) : null;
          if (!sig) {
            var ttk = ttLikedKind(url, (init && init.method) || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET'));
            if (ttk) readTtFetch(p, ttk, url);
            probeUnmatched(url); probeFbMobile(url, body);
            probeTtDigg(url, init && init.body, input,
              (init && init.method) || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET'));
          }
          if (sig && p && typeof p.then === 'function') {
            p.then(
              function (res) { report(sig, url, body, !!(res && res.ok)); },
              function () {   }
            );
          }
        } catch (e) {   }
        return p;
      };
      try { window.fetch = blendIn(wrappedFetch, 'fetch', 1); } catch (e) {   }
    }

    try {
      var oBeacon = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
      if (oBeacon) {
        navigator.sendBeacon = function (url, data) {
          try {
            if (ttNetWanted(url, 'POST')) probeTtNet('beacon', 'POST', url, bodyShape(data, null), []);
          } catch (e) {   }
          try {
            var body = bodyText(data);
            var sig = matchSig(String(url || ''), body);
            if (sig) {
              var sent = oBeacon(url, data);
              report(sig, String(url || ''), body, sent !== false);
              return sent;
            }
          } catch (e) {   }
          return oBeacon(url, data);
        };
      }
    } catch (e) {   }

    var XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      var oOpen = XHR.prototype.open;
      var oSend = XHR.prototype.send;
      var xhrUrls = typeof WeakMap === 'function' ? new WeakMap() : null;
      var xhrGets = typeof WeakMap === 'function' ? new WeakMap() : null;
      if (typeof oOpen === 'function' && typeof oSend === 'function' && xhrUrls) {
        try {
          XHR.prototype.open = blendIn(function (method, url) {
            try { xhrUrls.set(this, String(url == null ? '' : url)); } catch (e) {   }
            try { if (xhrGets) { if (String(method || 'GET').toUpperCase() === 'GET') xhrGets.set(this, 1); else xhrGets.delete(this); } } catch (e) {   }
            try { if (ttHdrs && ttHost()) ttHdrs.set(this, { m: String(method || 'GET'), h: [] }); } catch (e) {   }
            return oOpen.apply(this, arguments);
          }, 'open', oOpen.length);
          var oSetHdr = XHR.prototype.setRequestHeader;
          if (typeof oSetHdr === 'function' && ttHdrs && ttHost()) {
            XHR.prototype.setRequestHeader = blendIn(function (name) {
              try { var rec = ttHdrs.get(this); if (rec && rec.h.length < 25) rec.h.push(String(name).slice(0, 40).toLowerCase()); } catch (e) {   }
              return oSetHdr.apply(this, arguments);
            }, 'setRequestHeader', oSetHdr.length);
          }
          XHR.prototype.send = blendIn(function (body) {
            var xhr = this;
            try {
              var u = '';
              try { u = xhrUrls.get(xhr) || ''; } catch (e) { u = ''; }
              try {
                var tr = ttHdrs ? ttHdrs.get(xhr) : null;
                if (tr && u && ttNetWanted(u, tr.m)) probeTtNet('xhr', tr.m, u, bodyShape(body, null), tr.h);
              } catch (e) {   }
              var b = bodyText(body);
              var sig = u ? matchSig(u, b) : null;
              if (!sig) {
                var ttx = u && xhrGets && xhrGets.get(xhr) ? ttLikedKind(u, 'GET') : null;
                if (ttx && typeof xhr.addEventListener === 'function') readTtXhr(xhr, ttx, u);
                probeUnmatched(u); probeFbMobile(u, b); probeTtDigg(u, body, null, 'xhr');
              }
              if (sig && typeof xhr.addEventListener === 'function') {
                xhr.addEventListener('loadend', function () {
                  var ok = false;
                  try { ok = xhr.status >= 200 && xhr.status < 300; } catch (e) { ok = false; }
                  report(sig, u, b, ok);
                });
              }
            } catch (e) {   }
            return oSend.apply(this, arguments);
          }, 'send', oSend.length);
        } catch (e) {   }
      }
    }
  } catch (e) {   }
})();
