self.RGCFrame = (function () {
  const CSS = `
    .frame{position:fixed;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif}
    .card{width:min(var(--rgc-w,240px), calc(100vw - 32px));box-sizing:border-box;background:#0E1B2C;color:#F4EFE3;border:1px solid #C9A766;border-radius:13px;box-shadow:0 18px 50px rgba(0,0,0,.55)}
    .bar{display:flex;align-items:center;gap:8px;padding:11px 13px;cursor:grab;user-select:none;touch-action:none;border-bottom:1px solid rgba(201,167,102,.16)}
    .bar:active{cursor:grabbing}
    .dot{width:7px;height:7px;border-radius:50%;background:#53FC18;flex:none;box-shadow:0 0 8px rgba(83,252,24,.7)}
    .ttl{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#C9A766;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ver{font-family:ui-monospace,monospace;font-size:9px;letter-spacing:.04em;color:#6B6960;flex:none}
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
  const viewW = () => Math.min(window.innerWidth || Infinity, document.documentElement.clientWidth || Infinity) || window.innerWidth;
  const viewH = () => Math.min(window.innerHeight || Infinity, document.documentElement.clientHeight || Infinity) || window.innerHeight;
  const EDGE = 0;

  let VER = '';
  try { VER = (chrome.runtime.getManifest().version) || ''; } catch {   }

  function mount(opts) {
    const key = 'frame:' + opts.key;
    const host = document.createElement('div');
    host.id = 'rgc-frame-' + opts.key;
    host.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = CSS + (opts.css || '');

    const frame = document.createElement('div'); frame.className = 'frame';
    frame.style.setProperty('--rgc-w', (opts.width || 240) + 'px');

    const pill = document.createElement('div'); pill.className = 'pill hidden';
    const pdot = document.createElement('span'); pdot.className = 'dot';
    const pttl = document.createElement('span'); pttl.className = 'ttl'; pttl.textContent = opts.title || '';
    const pval = document.createElement('span'); pval.className = 'pv';
    pill.append(pdot, pttl, pval);

    const card = document.createElement('div'); card.className = 'card';
    const bar = document.createElement('div'); bar.className = 'bar';
    const bdot = document.createElement('span'); bdot.className = 'dot';
    const bttl = document.createElement('span'); bttl.className = 'ttl'; bttl.textContent = opts.title || '';
    const bver = document.createElement('button'); bver.type = 'button';
    bver.className = 'ver'; bver.textContent = VER ? 'v' + VER : '';
    bver.disabled = true; bver.style.cursor = 'default'; bver.style.background = 'none';
    bver.style.border = '0'; bver.style.padding = '0';
    try {
      chrome.storage.local.get('extUpdate').then((s) => {
        const u = s && s.extUpdate;
        if (!u || !u.available) return;
        bver.textContent = 'Update ⬆';
        bver.classList.add('upd');
        bver.disabled = false;
        bver.removeAttribute('style');
        bver.title = 'Install v' + u.latest + ' now (you are on v' + VER + ')';
        bver.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (bver.disabled) return;
          bver.disabled = true;
          bver.textContent = 'Updating…';
          let r = null;
          try { r = await chrome.runtime.sendMessage({ type: 'applyUpdate' }); } catch { r = null; }
          if (r && r.status === 'unsupported') {
            bver.textContent = 'Open add-ons site';
            bver.disabled = false;
            bver.title = 'Firefox installs updates from addons.mozilla.org';
            bver.onclick = () => { try { window.open(r.url || 'https://addons.mozilla.org/firefox/addon/rinaudo-capital/', '_blank', 'noopener'); } catch {   } };
            return;
          }
          if (r && r.status === 'update_available') { bver.textContent = 'Installing…'; return; }
          if (r && r.status === 'no_update') { bver.textContent = 'Already newest'; return; }
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
    } catch {   }
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
      try { chrome.storage.local.set({ [key]: { collapsed, pos } }); } catch {   }
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
      frame.style.left = clamp(x, EDGE, Math.max(EDGE, viewW() - w - EDGE)) + 'px';
      frame.style.top = clamp(y, EDGE, Math.max(EDGE, viewH() - h - EDGE)) + 'px';
      frame.style.right = 'auto'; frame.style.bottom = 'auto';
    }

    function keepInView() {
      const r = frame.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const nx = clamp(r.left, EDGE, Math.max(EDGE, viewW() - r.width - EDGE));
      const ny = clamp(r.top, EDGE, Math.max(EDGE, viewH() - r.height - EDGE));
      if (Math.abs(nx - r.left) > 0.5 || Math.abs(ny - r.top) > 0.5) {
        frame.style.left = nx + 'px'; frame.style.top = ny + 'px';
        frame.style.right = 'auto'; frame.style.bottom = 'auto';
      }
    }
    window.addEventListener('resize', keepInView);
    let ro = null;
    try { ro = new ResizeObserver(keepInView); ro.observe(frame); } catch {   }

    placeDefault();
    try {
      chrome.storage.local.get(key).then((s) => {
        const v = s && s[key];
        if (!v) return;
        if (v.pos) { pos = v.pos; placeXY(pos.x, pos.y); }
        if (v.collapsed) setCollapsed(true, false);
        keepInView();
      }).catch(() => {});
    } catch {   }

    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    bar.addEventListener('pointerdown', (e) => {
      if (e.target === minBtn) return;
      dragging = true;
      const r = frame.getBoundingClientRect();
      ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
      try { bar.setPointerCapture(e.pointerId); } catch {   }
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => { if (dragging) placeXY(ox + (e.clientX - sx), oy + (e.clientY - sy)); });
    bar.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      try { bar.releasePointerCapture(e.pointerId); } catch {   }
      const r = frame.getBoundingClientRect();
      pos = { x: r.left, y: r.top }; save();
    });
    bar.addEventListener('pointercancel', (e) => {
      if (!dragging) return;
      dragging = false;
      try { bar.releasePointerCapture(e.pointerId); } catch {   }
    });

    return {
      body,
      setPill(text) { pval.textContent = text || ''; },
      setTitle(text) { bttl.textContent = text || ''; pttl.textContent = text || ''; },
      destroy() {
        try { window.removeEventListener('resize', keepInView); } catch {   }
        try { if (ro) ro.disconnect(); } catch {   }
        try { host.remove(); } catch {   }
      },
    };
  }

  return { mount };
})();
