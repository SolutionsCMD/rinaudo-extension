// Shared on-page indicator chrome for the YouTube/X earn widgets and the Kick
// vote card. Gives each a fixed, DRAGGABLE, COLLAPSIBLE shadow-DOM frame with a
// branded header bar. Callers render their own content into `body`; the frame
// remembers position + collapsed state per `key` (chrome.storage.local), so a
// member can drag it to a nice spot once and it stays there.
//
// Loaded before each content script (see manifest content_scripts). Exposes a
// single global: self.RGCFrame.mount(opts) -> { body, setPill, setTitle, destroy }.
self.RGCFrame = (function () {
  const CSS = `
    .frame{position:fixed;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif}
    .card{width:min(var(--rgc-w,240px), calc(100vw - 32px));box-sizing:border-box;background:#0E1B2C;color:#F4EFE3;border:1px solid #C9A766;border-radius:13px;box-shadow:0 18px 50px rgba(0,0,0,.55)}
    .bar{display:flex;align-items:center;gap:8px;padding:11px 13px;cursor:grab;user-select:none;border-bottom:1px solid rgba(201,167,102,.16)}
    .bar:active{cursor:grabbing}
    .dot{width:7px;height:7px;border-radius:50%;background:#53FC18;flex:none;box-shadow:0 0 8px rgba(83,252,24,.7)}
    .ttl{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#C9A766;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ver{font-family:ui-monospace,monospace;font-size:9px;letter-spacing:.04em;color:#6B6960;flex:none}
    /* An update waiting turns the version badge into a real button. It used to be a
       tooltip telling members to go and open the extension icon, which is a menu almost
       nobody opens, which is how a room ends up spread across eight releases. */
    .ver.upd{color:#0E1B2C;background:#E8B339;border-radius:999px;padding:2px 7px;cursor:pointer;
      font-weight:700;letter-spacing:.02em;border:0;font-family:inherit}
    .ver.upd:hover{background:#F4C95A}
    .ver.upd:disabled{opacity:.75;cursor:default}
    .min{cursor:pointer;color:#8A8678;font-size:17px;line-height:1;background:none;border:0;padding:0 3px;font-family:inherit}
    .min:hover{color:#F4EFE3}
    .body{padding:11px 14px 14px}
    .pill{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;background:#0E1B2C;border:1px solid #C9A766;box-shadow:0 12px 30px rgba(0,0,0,.5);cursor:pointer;user-select:none}
    .pill .ttl{flex:none}
    .pill .pv{font-size:12px;color:#A9A697;font-variant-numeric:tabular-nums}
    .hidden{display:none}`;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Extension version, shown in every frame header so users can report it from a screenshot.
  let VER = '';
  try { VER = (chrome.runtime.getManifest().version) || ''; } catch { /* ignore */ }

  function mount(opts) {
    const key = 'frame:' + opts.key;
    const host = document.createElement('div');
    host.id = 'rgc-frame-' + opts.key;
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = CSS + (opts.css || '');

    const frame = document.createElement('div'); frame.className = 'frame';
    frame.style.setProperty('--rgc-w', (opts.width || 240) + 'px');

    // Collapsed pill.
    const pill = document.createElement('div'); pill.className = 'pill hidden';
    const pdot = document.createElement('span'); pdot.className = 'dot';
    const pttl = document.createElement('span'); pttl.className = 'ttl'; pttl.textContent = opts.title || '';
    const pval = document.createElement('span'); pval.className = 'pv';
    pill.append(pdot, pttl, pval);

    // Expanded card: header bar (drag handle + minimize) + body.
    const card = document.createElement('div'); card.className = 'card';
    const bar = document.createElement('div'); bar.className = 'bar';
    const bdot = document.createElement('span'); bdot.className = 'dot';
    const bttl = document.createElement('span'); bttl.className = 'ttl'; bttl.textContent = opts.title || '';
    // Plain text normally; a button while an update is waiting. Built as a <button> up
    // front so it can take a click without being swapped out later.
    const bver = document.createElement('button'); bver.type = 'button';
    bver.className = 'ver'; bver.textContent = VER ? 'v' + VER : '';
    bver.disabled = true; bver.style.cursor = 'default'; bver.style.background = 'none';
    bver.style.border = '0'; bver.style.padding = '0';
    // UPDATE IN PLACE. The extension already knew a newer version was published and said so
    // in a tooltip that told members to open the extension icon and hit Update now. Almost
    // nobody opens that menu, which is why the room sits several releases behind while real
    // ticket bugs stay fixed-but-undelivered. This is the same action on the surface people
    // actually look at (owner, 2026-08-21).
    //
    // Chrome can genuinely self-update (requestUpdateCheck + reload, handled by the service
    // worker). Firefox cannot: it installs only from AMO, so there the button opens the
    // listing instead. The flag itself is driven by what the STORE has published, so this
    // never offers an update that cannot actually be installed.
    try {
      chrome.storage.local.get('extUpdate').then((s) => {
        const u = s && s.extUpdate;
        if (!u || !u.available) return;
        // Short label on purpose: the header is one narrow row and "Update to v1.156"
        // pushed the title down to "EARN T…", which reads as a broken widget rather than
        // an offer. The version lives in the tooltip, where it costs no width.
        bver.textContent = 'Update ⬆';
        bver.classList.add('upd');
        bver.disabled = false;
        bver.removeAttribute('style');
        bver.title = 'Install v' + u.latest + ' now (you are on v' + VER + ')';
        bver.addEventListener('click', async (e) => {
          e.stopPropagation(); // the bar is the drag handle
          if (bver.disabled) return;
          bver.disabled = true;
          bver.textContent = 'Updating…';
          let r = null;
          try { r = await chrome.runtime.sendMessage({ type: 'applyUpdate' }); } catch { r = null; }
          // 'unsupported' is Firefox: no requestUpdateCheck, updates come from AMO only.
          if (r && r.status === 'unsupported') {
            bver.textContent = 'Open add-ons site';
            bver.disabled = false;
            bver.title = 'Firefox installs updates from addons.mozilla.org';
            bver.onclick = () => { try { window.open(r.url || 'https://addons.mozilla.org/firefox/addon/rinaudo-capital/', '_blank', 'noopener'); } catch { /* ignore */ } };
            return;
          }
          // Chrome found it: the worker reloads the extension 300ms later, which tears this
          // page's content scripts down with it. Nothing more to say, and saying "failed"
          // in that window would be a lie told right before the text disappears.
          if (r && r.status === 'update_available') { bver.textContent = 'Installing…'; return; }
          if (r && r.status === 'no_update') { bver.textContent = 'Already newest'; return; }
          // Chrome rate-limits requestUpdateCheck, and a throttled check is not a failure:
          // the browser will pick the update up on its own schedule.
          if (r && r.status === 'throttled') {
            bver.textContent = 'Try again shortly';
            bver.disabled = false;
            bver.title = 'Chrome limits how often an extension may check. It will update on its own soon.';
            return;
          }
          bver.textContent = 'Update failed';
          bver.disabled = false;
          bver.title = 'Could not update from here. Open the extension icon and try Update now.';
        });
      }).catch(() => {});
    } catch { /* ignore */ }
    const minBtn = document.createElement('button'); minBtn.className = 'min'; minBtn.type = 'button'; minBtn.textContent = '−'; minBtn.title = 'Minimize';
    bar.append(bdot, bttl, bver, minBtn);
    const body = document.createElement('div'); body.className = 'body';
    card.append(bar, body);

    frame.append(card, pill);
    shadow.append(style, frame);
    (document.body || document.documentElement).appendChild(host);

    let collapsed = false, pos = null;

    function applyCollapsed() {
      card.classList.toggle('hidden', collapsed);
      pill.classList.toggle('hidden', !collapsed);
    }
    function save() {
      try { chrome.storage.local.set({ [key]: { collapsed, pos } }); } catch { /* ignore */ }
    }
    function setCollapsed(v, persist) { collapsed = v; applyCollapsed(); if (persist) save(); }
    minBtn.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(true, true); });
    pill.addEventListener('click', () => setCollapsed(false, true));

    function placeDefault() {
      const p = opts.pos || { top: 72, right: 16 };
      frame.style.top = p.top != null ? p.top + 'px' : 'auto';
      frame.style.bottom = p.top == null ? (p.bottom != null ? p.bottom : 16) + 'px' : 'auto';
      frame.style.left = p.left != null ? p.left + 'px' : 'auto';
      frame.style.right = p.left == null ? (p.right != null ? p.right : 16) + 'px' : 'auto';
    }
    function placeXY(x, y) {
      const r = frame.getBoundingClientRect();
      const w = r.width || opts.width || 240, h = r.height || 80;
      frame.style.left = clamp(x, 4, window.innerWidth - w - 4) + 'px';
      frame.style.top = clamp(y, 4, window.innerHeight - h - 4) + 'px';
      frame.style.right = 'auto'; frame.style.bottom = 'auto';
    }

    // Never let the card leave the window. A dragged position is absolute pixels, and a
    // window that shrinks afterwards (resize, zoom, theater mode, a laptop screen after a
    // monitor) left the card - drag bar included - outside the viewport with no way to
    // pull it back (owner, 2026-08-17: "getting clipped off the screen and they cant move
    // it"). Re-clamp on every resize AND whenever the card's own size changes, because a
    // poll with many options grows the card downward past the bottom edge.
    function keepInView() {
      const r = frame.getBoundingClientRect();
      if (!r.width || !r.height) return; // hidden or not laid out yet
      const nx = clamp(r.left, 4, Math.max(4, window.innerWidth - r.width - 4));
      const ny = clamp(r.top, 4, Math.max(4, window.innerHeight - r.height - 4));
      if (Math.abs(nx - r.left) > 0.5 || Math.abs(ny - r.top) > 0.5) {
        frame.style.left = nx + 'px'; frame.style.top = ny + 'px';
        frame.style.right = 'auto'; frame.style.bottom = 'auto';
      }
    }
    window.addEventListener('resize', keepInView);
    let ro = null;
    try { ro = new ResizeObserver(keepInView); ro.observe(frame); } catch { /* older engines */ }

    placeDefault();
    try {
      chrome.storage.local.get(key).then((s) => {
        const v = s && s[key];
        if (!v) return;
        if (v.pos) { pos = v.pos; placeXY(pos.x, pos.y); }
        if (v.collapsed) setCollapsed(true, false);
        keepInView(); // a spot saved on a bigger window must still land on THIS one
      }).catch(() => {});
    } catch { /* ignore */ }

    // Drag by the header bar (not the minimize button).
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    bar.addEventListener('pointerdown', (e) => {
      if (e.target === minBtn) return;
      dragging = true;
      const r = frame.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      try { bar.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => { if (dragging) placeXY(ox + (e.clientX - sx), oy + (e.clientY - sy)); });
    bar.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      try { bar.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      const r = frame.getBoundingClientRect();
      pos = { x: r.left, y: r.top }; save();
    });

    return {
      body,
      setPill(text) { pval.textContent = text || ''; },
      setTitle(text) { bttl.textContent = text || ''; pttl.textContent = text || ''; },
      destroy() {
        try { window.removeEventListener('resize', keepInView); } catch { /* ignore */ }
        try { if (ro) ro.disconnect(); } catch { /* ignore */ }
        try { host.remove(); } catch { /* ignore */ }
      },
    };
  }

  return { mount };
})();
