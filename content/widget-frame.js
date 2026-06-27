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
    .card{width:var(--rgc-w,240px);background:#0E1B2C;color:#F4EFE3;border:1px solid #C9A766;border-radius:13px;box-shadow:0 18px 50px rgba(0,0,0,.55)}
    .bar{display:flex;align-items:center;gap:8px;padding:11px 13px;cursor:grab;user-select:none;border-bottom:1px solid rgba(201,167,102,.16)}
    .bar:active{cursor:grabbing}
    .dot{width:7px;height:7px;border-radius:50%;background:#53FC18;flex:none;box-shadow:0 0 8px rgba(83,252,24,.7)}
    .ttl{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#C9A766;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ver{font-family:ui-monospace,monospace;font-size:9px;letter-spacing:.04em;color:#6B6960;flex:none}
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
    const bver = document.createElement('span'); bver.className = 'ver'; bver.textContent = VER ? 'v' + VER : '';
    const minBtn = document.createElement('button'); minBtn.className = 'min'; minBtn.type = 'button'; minBtn.textContent = '–'; minBtn.title = 'Minimize';
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

    placeDefault();
    try {
      chrome.storage.local.get(key).then((s) => {
        const v = s && s[key];
        if (!v) return;
        if (v.pos) { pos = v.pos; placeXY(pos.x, pos.y); }
        if (v.collapsed) setCollapsed(true, false);
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
      destroy() { try { host.remove(); } catch { /* ignore */ } },
    };
  }

  return { mount };
})();
