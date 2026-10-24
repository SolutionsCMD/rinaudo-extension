(() => {
  'use strict';

  function timeLeft(expiresAt, now) {
    if (!expiresAt) return '';
    const ms = new Date(expiresAt).getTime() - now;
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'under a minute left';
    const h = Math.floor(m / 60), r = m % 60;
    return h ? (r ? `${h}h ${r}m left` : `${h}h left`) : `${m}m left`;
  }
  function payingItems(data, elig, now) {
    const out = [];
    if (!data || !Array.isArray(data.targets) || !elig) return out;
    const seen = new Set();
    for (const t of data.targets) {
      if (!t || t.platform !== 'youtube' || t.listed !== true || !t.ref) continue;
      const ref = String(t.ref);
      if (seen.has(ref)) continue;
      const e = elig.get(ref);
      const tickets = e && Number(e.remaining) > 0 ? Number(e.remaining) : 0;
      if (!tickets) continue;
      if (t.expiresAt && new Date(t.expiresAt).getTime() <= now) continue;
      seen.add(ref);
      out.push({
        ref,
        url: typeof t.url === 'string' && /^https:\/\/(www\.|m\.)?youtube\.com\//.test(t.url) ? t.url : `https://www.youtube.com/watch?v=${ref}`,
        title: (typeof t.label === 'string' && t.label.trim()) ? t.label.trim() : 'New Mizkif video',
        tickets,
        left: timeLeft(t.expiresAt, now),
      });
    }
    return out;
  }
  const keyOf = (items) => items.map((i) => i.ref).sort().join(',');
  function hasNew(items, rememberedKey) {
    const old = new Set(String(rememberedKey || '').split(',').filter(Boolean));
    return items.some((i) => !old.has(i.ref));
  }
  const isHome = (host, path) => /(^|\.)youtube\.com$/.test(host) && (path === '/' || path === '');

  try { self.RGC_YT_HOME_ALERT = { timeLeft, payingItems, hasNew, keyOf, isHome }; } catch {   }

  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;

  const SEEN_KEY = 'ytHomeAlertSeen', CARD_KEY = 'ytHomeAlertCardHidden';
  const REFRESH_MS = 60000, DEBOUNCE_MS = 500, MAX_ROWS = 5;
  let dead = false, items = [], seenKey = '', cardHiddenKey = '', stateLoaded = false;
  let btnHost = null, cardHost = null, dropOpen = false;
  let obs = null, debounce = 0, refreshT = 0, lastPath = '';
  let wantBtn = false;

  function G() { try { return self.RGC_GRID_HIGHLIGHT && self.RGC_GRID_HIGHLIGHT.shared; } catch { return null; } }
  function ticketSrc() {
    try { const A = self.RGCGuideAssets; const t = A && (A.ticket || (A.img && A.img.ticket)); return typeof t === 'string' && t.indexOf('data:image/') === 0 ? t : ''; } catch { return ''; }
  }
  const dark = () => { try { return document.documentElement.hasAttribute('dark'); } catch { return true; } };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function go(url) { try { location.assign(url); } catch {   } }

  const PALETTE = () => (dark()
    ? { bg: '#282828', ink: '#f1f1f1', sub: '#aaaaaa', line: 'rgba(255,255,255,.1)', hover: 'rgba(255,255,255,.1)' }
    : { bg: '#ffffff', ink: '#0f0f0f', sub: '#606060', line: 'rgba(0,0,0,.1)', hover: 'rgba(0,0,0,.05)' });
  const BASE = 'all:initial;font-family:Roboto,Arial,sans-serif;';

  function rowsInto(list, P) {
    list.textContent = '';
    for (const it of items.slice(0, MAX_ROWS)) {
      const a = el('a', 'row'); a.href = it.url;
      a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); go(it.url); });
      const img = el('img', 'th'); img.src = `https://i.ytimg.com/vi/${encodeURIComponent(it.ref)}/mqdefault.jpg`; img.alt = '';
      const txt = el('div', 'tx');
      txt.appendChild(el('div', 'tt', it.title));
      const sub = el('div', 'sb');
      sub.appendChild(el('b', 'pay', `+${it.tickets} tickets`));
      if (it.left) sub.appendChild(el('span', '', ` · ${it.left}`));
      txt.appendChild(sub);
      a.appendChild(img); a.appendChild(txt); list.appendChild(a);
    }
  }
  function listCss(P) {
    return `.row{display:flex;gap:12px;align-items:center;padding:8px 16px;text-decoration:none;color:${P.ink};cursor:pointer}
      .row:hover{background:${P.hover}}
      .th{width:112px;height:63px;border-radius:8px;object-fit:cover;flex:none;background:#000}
      .tx{min-width:0}.tt{font-size:14px;line-height:20px;font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .sb{font-size:12px;color:${P.sub};margin-top:2px}.pay{color:#ff4e45;font-weight:700}`;
  }

  function buildButton() {
    const host = document.createElement('rgc-yt-alert'); host.id = 'rgc-yt-alert-btn';
    host.style.cssText = 'display:inline-flex!important;position:relative!important;align-items:center!important;margin-right:8px!important';
    const root = host.attachShadow({ mode: 'open' });
    const P = PALETTE();
    root.appendChild(el('style', '', `
      :host{${BASE}}
      .b{width:40px;height:40px;border-radius:50%;border:0;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;padding:0}
      .b:hover{background:${P.hover}}
      .b img{width:30px;height:auto;display:block}
      .n{position:absolute;top:1px;right:0;min-width:16px;height:16px;padding:0 4px;box-sizing:border-box;border-radius:8px;background:#cc0000;color:#fff;font:500 11px/16px Roboto,Arial,sans-serif;text-align:center;border:2px solid ${dark() ? '#0f0f0f' : '#fff'}}
      .d{position:absolute;top:44px;right:-8px;width:420px;max-width:calc(100vw - 24px);background:${P.bg};color:${P.ink};border-radius:12px;box-shadow:0 4px 32px rgba(0,0,0,.35);padding:0 0 8px;display:none;z-index:2300;opacity:0;transition:opacity .15s}
      .d.show{display:block}.d.in{opacity:1}
      .h{display:flex;align-items:center;justify-content:space-between;padding:12px 8px 8px 16px;border-bottom:1px solid ${P.line};margin-bottom:8px;font-size:16px;font-weight:500}
      .x{width:36px;height:36px;border-radius:50%;border:0;background:transparent;color:${P.ink};font-size:20px;cursor:pointer;line-height:1}
      .x:hover{background:${P.hover}}
      ${listCss(P)}`));
    const b = el('button', 'b'); b.type = 'button'; b.title = 'Mizkif videos paying tickets';
    const src = ticketSrc(); if (src) { const i = el('img'); i.src = src; i.alt = ''; b.appendChild(i); } else b.appendChild(el('span', '', '🎟'));
    const n = el('span', 'n'); b.appendChild(n);
    const d = el('div', 'd'); d.setAttribute('role', 'dialog');
    const h = el('div', 'h'); h.appendChild(el('span', '', 'Mizkif videos paying tickets'));
    const x = el('button', 'x', '×'); x.type = 'button'; x.title = 'Close'; h.appendChild(x);
    const list = el('div', 'l'); d.appendChild(h); d.appendChild(list);
    b.addEventListener('click', (e) => { e.stopPropagation(); setDrop(!dropOpen); });
    x.addEventListener('click', (e) => { e.stopPropagation(); setDrop(false); });
    d.addEventListener('click', (e) => e.stopPropagation());
    root.appendChild(b); root.appendChild(d);
    host._rgc = { n, d, list, P };
    return host;
  }
  function setDrop(open) {
    dropOpen = !!open;
    if (!btnHost || !btnHost._rgc) return;
    const { d, list, P } = btnHost._rgc;
    if (dropOpen) { rowsInto(list, P); d.classList.add('show'); requestAnimationFrame(() => d.classList.add('in')); }
    else { d.classList.remove('in', 'show'); }
  }
  function onDocClick() { if (dropOpen) setDrop(false); }

  function buildCard() {
    const host = document.createElement('rgc-yt-alert'); host.id = 'rgc-yt-alert-card';
    host.style.cssText = 'position:fixed!important;right:16px!important;bottom:16px!important;z-index:2300!important;display:block!important';
    const root = host.attachShadow({ mode: 'open' });
    const P = PALETTE();
    root.appendChild(el('style', '', `
      :host{${BASE}}
      .k{width:380px;max-width:calc(100vw - 32px);background:${P.bg};color:${P.ink};border-radius:12px;box-shadow:0 4px 32px rgba(0,0,0,.4);padding:0 0 8px;opacity:0;transition:opacity .2s;border-top:4px solid #cc0000}
      .k.in{opacity:1}
      .h{display:flex;align-items:center;justify-content:space-between;padding:10px 8px 6px 16px;font-size:15px;font-weight:500}
      .x{width:32px;height:32px;border-radius:50%;border:0;background:transparent;color:${P.ink};font-size:20px;cursor:pointer}
      .x:hover{background:${P.hover}}
      ${listCss(P)}`));
    const k = el('div', 'k');
    const h = el('div', 'h'); h.appendChild(el('span', '', 'Mizkif videos paying tickets'));
    const x = el('button', 'x', '×'); x.type = 'button'; x.title = 'Hide until a new video'; h.appendChild(x);
    const list = el('div', 'l'); k.appendChild(h); k.appendChild(list);
    x.addEventListener('click', (e) => { e.stopPropagation(); cardHiddenKey = keyOf(items); store(CARD_KEY, cardHiddenKey); removeCard(); });
    root.appendChild(k);
    host._rgc = { k, list, P };
    requestAnimationFrame(() => k.classList.add('in'));
    return host;
  }

  function removeBtn() { if (btnHost) { try { btnHost.remove(); } catch {   } btnHost = null; dropOpen = false; } }
  function removeCard() { if (cardHost) { try { cardHost.remove(); } catch {   } cardHost = null; } }
  function removeAll() { removeBtn(); removeCard(); }

  function store(k, v) { try { chrome.storage.local.set({ [k]: v }); } catch {   } }

  function headerAnchor() {
    const bell = document.querySelector('ytd-masthead #end #buttons ytd-notification-topbar-button-renderer');
    if (bell && bell.parentElement) return { parent: bell.parentElement, before: bell };
    const buttons = document.querySelector('ytd-masthead #end #buttons');
    return buttons ? { parent: buttons, before: buttons.firstChild } : null;
  }
  function alive() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch { return false; }
  }
  function otherCopy(id, mine) {
    const n = document.getElementById(id);
    return !!(n && n !== mine);
  }
  function render() {
    if (dead) return;
    if (!alive()) { teardown(); return; }
    try {
      if (!items.length) { wantBtn = false; removeAll(); return; }
      const home = isHome(location.hostname, location.pathname);
      wantBtn = true;
      const count = String(Math.min(items.length, 9));
      const newKey = keyOf(items);
      const ha = headerAnchor();
      if (ha) {
        if ((!btnHost || !btnHost.isConnected) && otherCopy('rgc-yt-alert-btn', btnHost)) { removeBtn(); return; }
        if (!btnHost || !btnHost.isConnected) { removeBtn(); btnHost = buildButton(); ha.parent.insertBefore(btnHost, ha.before); }
        btnHost._rgc.n.textContent = count;
        if (dropOpen) rowsInto(btnHost._rgc.list, btnHost._rgc.P);
        if (home && stateLoaded && hasNew(items, seenKey)) { seenKey = newKey; store(SEEN_KEY, seenKey); setDrop(true); }
      } else removeBtn();
      const cardWanted = home && !ha && (!cardHiddenKey || hasNew(items, cardHiddenKey));
      if (cardWanted) {
        if ((!cardHost || !cardHost.isConnected) && otherCopy('rgc-yt-alert-card', cardHost)) { removeCard(); return; }
        if (!cardHost || !cardHost.isConnected) { removeCard(); cardHost = buildCard(); (document.body || document.documentElement).appendChild(cardHost); }
        rowsInto(cardHost._rgc.list, cardHost._rgc.P);
      } else removeCard();
    } catch { teardown(); }
  }

  function refresh(force) {
    if (dead) return;
    try {
      if (document.hidden) return;
      const g = G();
      if (!g || g.platform !== 'youtube') return;
      const apply = () => { try { items = payingItems(g.loader.data(), g.eligible(), Date.now()); render(); } catch { teardown(); } };
      apply();
      Promise.resolve(g.loader.load(!!force)).then((changed) => { if (changed) apply(); }, () => {});
    } catch { teardown(); }
  }

  function poke() { clearTimeout(debounce); debounce = setTimeout(() => refresh(false), DEBOUNCE_MS); }
  function onNav() {
    const p = location.pathname;
    if (p !== lastPath) { lastPath = p; setDrop(false); refresh(true); } else poke();
  }
  function schedule() {
    clearTimeout(refreshT);
    refreshT = setTimeout(() => { refresh(false); schedule(); }, REFRESH_MS);
  }
  function onVisibility() { if (!document.hidden) refresh(false); }

  function teardown() {
    if (dead) return;
    dead = true;
    try { removeAll(); } catch {   }
    try { if (obs) obs.disconnect(); } catch {   }
    clearTimeout(debounce); clearTimeout(refreshT);
    try { document.removeEventListener('yt-navigate-finish', onNav); window.removeEventListener('yt-navigate-finish', onNav); } catch {   }
    try { window.removeEventListener('popstate', onNav); } catch {   }
    try { document.removeEventListener('visibilitychange', onVisibility); } catch {   }
    try { document.removeEventListener('click', onDocClick); } catch {   }
  }

  function start() {
    try {
      lastPath = location.pathname;
      document.addEventListener('yt-navigate-finish', onNav);
      window.addEventListener('yt-navigate-finish', onNav);
      window.addEventListener('popstate', onNav);
      document.addEventListener('visibilitychange', onVisibility);
      document.addEventListener('click', onDocClick);
      if (typeof MutationObserver === 'function') {
        obs = new MutationObserver(() => {
          if (location.pathname !== lastPath) { onNav(); return; }
          if (!wantBtn) return;
          if (!btnHost || !btnHost.isConnected) { if (!alive()) { teardown(); return; } if (!otherCopy('rgc-yt-alert-btn', btnHost)) poke(); }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
      }
      try {
        chrome.storage.local.get([SEEN_KEY, CARD_KEY]).then((o) => {
          seenKey = (o && o[SEEN_KEY]) || ''; cardHiddenKey = (o && o[CARD_KEY]) || '';
          stateLoaded = true; refresh(false);
        }).catch(() => { stateLoaded = true; refresh(false); });
      } catch { stateLoaded = true; }
      refresh(true);
      schedule();
    } catch { teardown(); }
  }

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  } catch {   }
})();
