(() => {
  'use strict';
  const ICON = 160;
  const NET_MS = 3000;
  const ART_MS = 5000;
  const BRAND = 'Mizkif Global';
  const FALLBACK_ICON = 'icons/brand-m.png';
  const IS_FIREFOX = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent || '');
  const C = { navy: '#060b15', gold: '#f3cc5c', goldDeep: '#d9a92e', jade: '#48d89f' };
  const SANS = '"DM Sans", "Segoe UI", Arial, sans-serif';

  const P = {
    youtube:   { name: 'YouTube',   thing: 'YouTube video',  icon: 'icons/youtube.png',   btn: 'Open YouTube' },
    tiktok:    { name: 'TikTok',    thing: 'TikTok',         icon: 'icons/tiktok.png',    btn: 'Open TikTok' },
    instagram: { name: 'Instagram', thing: 'Instagram post', icon: 'icons/instagram.png', btn: 'Open Instagram' },
    x:         { name: 'X',         thing: 'X post',         icon: 'icons/x.png',         btn: 'Open X' },
    facebook:  { name: 'Facebook',  thing: 'Facebook post',  icon: null, letter: 'f',     btn: 'Open Facebook' },
    reddit:    { name: 'Reddit',    thing: 'Reddit post',    icon: null, letter: 'r',     btn: 'Open Reddit' },
    kick:      { name: 'Kick',      thing: 'stream',         icon: 'icons/kick.png',      btn: 'Open Kick' },
  };
  const GENERIC = { name: 'Post', thing: 'post', icon: null, letter: 'M', btn: 'Open post' };
  const plat = (k) => P[k === 'twitter' ? 'x' : k] || GENERIC;
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));
  const ctx = (...parts) => [BRAND, ...parts].filter(Boolean).join(' · ');

  function withTimeout(p, ms) {
    let t; const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); });
    return Promise.race([p, to]).finally(() => clearTimeout(t));
  }
  async function fetchBlob(url, ms) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
    try { const r = await fetch(url, { signal: ac.signal }); return r.ok ? await r.blob() : null; }
    catch { return null; } finally { clearTimeout(t); }
  }
  const localCache = new Map();
  function local(path) {
    if (!localCache.has(path)) {
      localCache.set(path, (async () => {
        try { const b = await fetchBlob(chrome.runtime.getURL(path), NET_MS); return b ? await createImageBitmap(b) : null; } catch { return null; }
      })());
    }
    return localCache.get(path);
  }
  let fontsReady;
  function loadFont() {
    if (!fontsReady) fontsReady = (async () => {
      try { const f = new FontFace('DM Sans', 'url(' + chrome.runtime.getURL('fonts/dm-sans-latin.woff2') + ')', { weight: '100 1000' }); await withTimeout(f.load(), NET_MS); self.fonts.add(f); } catch {   }
    })();
    return fontsReady;
  }
  async function toDataUrl(canvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return 'data:image/png;base64,' + btoa(s);
  }
  function cleanLine(raw, max) {
    let s = String(raw == null ? '' : raw).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (s.length > max) { let i = s.lastIndexOf(' ', max); if (i < 20) i = max; s = s.slice(0, i).replace(/[\s,;:\-]+$/, '') + '…'; }
    return s;
  }
  function timeLeft(iso) {
    if (!iso) return null;
    const ms = Date.parse(iso) - Date.now();
    if (!(ms > 60000)) return null;
    const h = ms / 3600000;
    if (h < 1) { const n = Math.max(1, Math.round(ms / 60000)); return { ms, text: `${n} min left` }; }
    if (h < 48) { const n = Math.round(h); return { ms, text: `${n} hour${n === 1 ? '' : 's'} left` }; }
    return { ms, text: `${Math.round(h / 24)} days left` };
  }

  function ytId(url) {
    try {
      const u = new URL(String(url)); const h = u.hostname.replace(/^www\.|^m\./, '');
      if (h === 'youtu.be') return u.pathname.split('/')[1] || null;
      if (!h.endsWith('youtube.com')) return null;
      if (/^\/(shorts|live|embed)\//.test(u.pathname)) return u.pathname.split('/')[2] || null;
      return u.searchParams.get('v') || null;
    } catch { return null; }
  }
  const shortCache = new Map();
  function isShort(t) {
    if (/\/shorts\//.test(String(t.url || ''))) return Promise.resolve(true);
    const id = String(t.ref || ytId(t.url) || '');
    if (!/^[\w-]{6,20}$/.test(id)) return Promise.resolve(null);
    if (!shortCache.has(id)) {
      shortCache.set(id, (async () => {
        const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), NET_MS);
        try {
          const r = await fetch(`https://www.youtube.com/shorts/${id}`, { method: 'HEAD', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ac.signal });
          const end = String(r.url || '');
          if (/\/shorts\//.test(end) && r.ok) return true;
          if (/\/watch\b/.test(end)) return false;
          return null;
        } catch { return null; } finally { clearTimeout(tm); }
      })());
    }
    return shortCache.get(id);
  }
  async function thingFor(t) {
    if (t.platform === 'youtube') {
      const s = IS_FIREFOX ? null : await isShort(t);
      return s ? 'YouTube Short' : 'YouTube video';
    }
    return plat(t.platform).thing;
  }
  function todo(t) {
    const a = (t && t.actions) || {};
    const v = ['like', 'comment', 'repost'].filter((k) => a[k] === true);
    if (typeof a.watch === 'number' && a.watch > 0 && !v.length) return `Watch ${a.watch} min`;
    if (!v.length) return ['youtube', 'tiktok', 'kick'].includes(t.platform) || a.watch === true ? 'Watch it' : 'Open it';
    const cap = (s) => s[0].toUpperCase() + s.slice(1);
    if (v.length === 1) return v[0] === 'comment' ? 'Comment on it' : cap(v[0]) + ' it';
    return cap(v.slice(0, -1).join(', ') + ' or ' + v[v.length - 1]);
  }

  function rr(x, px, py, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
  }
  function ticketPath(x, w, h, r, n) {
    x.beginPath();
    x.moveTo(-w / 2 + r, -h / 2); x.lineTo(w / 2 - r, -h / 2); x.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    x.lineTo(w / 2, -n); x.arc(w / 2, 0, n, -Math.PI / 2, Math.PI / 2, true); x.lineTo(w / 2, h / 2 - r);
    x.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); x.lineTo(-w / 2 + r, h / 2); x.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    x.lineTo(-w / 2, n); x.arc(-w / 2, 0, n, Math.PI / 2, -Math.PI / 2, true); x.lineTo(-w / 2, -h / 2 + r);
    x.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); x.closePath();
  }
  async function badge(x, platform) {
    const p = plat(platform);
    if (!platform || p === GENERIC) return;
    const s = 54, px = ICON - s - 4, py = ICON - s - 4;
    const bmp = p.icon ? await local(p.icon) : null;
    x.save(); x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 8; x.shadowOffsetY = 2;
    rr(x, px - 4, py - 4, s + 8, s + 8, 16); x.fillStyle = '#fff'; x.fill(); x.restore();
    if (bmp) { x.save(); rr(x, px, py, s, s, 12); x.clip(); x.drawImage(bmp, px, py, s, s); x.restore(); return; }
    x.fillStyle = C.jade; rr(x, px, py, s, s, 12); x.fill();
    x.font = `800 34px ${SANS}`; x.fillStyle = C.navy; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(p.letter || 'M', px + s / 2, py + s / 2 + 1);
  }
  const TICKET_FILE = { youtube: 'youtube', tiktok: 'tiktok', instagram: 'instagram', x: 'x', twitter: 'x', facebook: 'facebook', reddit: 'reddit', kick: 'kick', multi: 'multi' };
  let specsCache;
  function ticketSpecs() {
    if (!specsCache) specsCache = (async () => {
      try { const j = await fetchBlob(chrome.runtime.getURL('icons/tickets/tickets.json'), NET_MS); return j ? JSON.parse(await j.text()) : {}; } catch { return {}; }
    })();
    return specsCache;
  }
  const validSpec = (s) => !!s && Number.isFinite(Number(s.cx)) && Number.isFinite(Number(s.cy));
  const artCache = new Map();
  function questArt(kind) {
    const file = TICKET_FILE[kind];
    const key = file || 'gold';
    if (!artCache.has(key)) artCache.set(key, (async () => {
      try {
        if (file) {
          const [bmp, specs] = await Promise.all([local(`icons/tickets/ticket-${file}.png`), ticketSpecs()]);
          const spec = specs[`ticket-${file}.png`];
          if (bmp && validSpec(spec)) return { bmp, spec };
        }
        const [bmp, j] = await Promise.all([local('icons/quest-ticket.png'), fetchBlob(chrome.runtime.getURL('icons/quest-ticket.json'), NET_MS)]);
        const spec = j ? JSON.parse(await j.text()) : null;
        return bmp && validSpec(spec) ? { bmp, spec } : null;
      } catch { return null; }
    })());
    return artCache.get(key);
  }
  const iconCache = new Map();
  function ticketIcon(n, platform) {
    const key = `${n}|${platform || ''}`;
    if (!iconCache.has(key)) {
      iconCache.set(key, (async () => {
        try {
          await loadFont();
          const c = new OffscreenCanvas(ICON, ICON), x = c.getContext('2d');
          const label = n > 0 ? `+${n}` : '+';
          const art = await questArt(platform || 'multi');
          if (art) {
            const k = ICON / art.bmp.width, a = art.spec;
            const hex = (v) => (/^#[0-9a-f]{3,8}$/i.test(v || '') ? v : null);
            x.imageSmoothingQuality = 'high';
            x.drawImage(art.bmp, 0, 0, ICON, ICON);
            x.save(); x.translate(a.cx * k, a.cy * k); x.rotate(((Number(a.rotateDeg) || 0) * Math.PI) / 180);
            let fs = (Number(a.fontPx) || 96) * k; x.font = `800 ${fs}px ${SANS}`;
            while (fs > 14 && x.measureText(label).width > (Number(a.maxWidth) || 160) * k) { fs -= 1; x.font = `800 ${fs}px ${SANS}`; }
            x.textAlign = 'center'; x.textBaseline = 'middle';
            if (hex(a.stroke)) { x.lineJoin = 'round'; x.lineWidth = Math.max(2, fs * 0.16); x.strokeStyle = a.stroke; x.strokeText(label, 0, 0); }
            x.fillStyle = hex(a.color) || C.navy;
            x.fillText(label, 0, 0);
            x.restore();
            return await toDataUrl(c);
          }
          x.save(); x.translate(76, 72); x.rotate(-0.17);
          const w = 140, h = 92;
          x.shadowColor = 'rgba(0,0,0,.30)'; x.shadowBlur = 10; x.shadowOffsetY = 4;
          ticketPath(x, w, h, 14, 16);
          const g = x.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(0, '#ffe08a'); g.addColorStop(1, C.gold);
          x.fillStyle = g; x.fill();
          x.shadowColor = 'transparent';
          x.lineWidth = 3; x.strokeStyle = C.goldDeep; x.stroke();
          x.setLineDash([6, 6]); x.lineWidth = 3; x.strokeStyle = 'rgba(6,11,21,.28)';
          x.beginPath(); x.moveTo(-w / 2 + 34, -h / 2 + 10); x.lineTo(-w / 2 + 34, h / 2 - 10); x.stroke(); x.setLineDash([]);
          let fs = 58; x.font = `800 ${fs}px ${SANS}`;
          while (fs > 30 && x.measureText(label).width > 82) { fs -= 2; x.font = `800 ${fs}px ${SANS}`; }
          x.fillStyle = C.navy; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(label, 16, 3);
          x.restore();
          await badge(x, platform);
          return await toDataUrl(c);
        } catch { return FALLBACK_ICON; }
      })());
    }
    return iconCache.get(key);
  }
  function logoIcon(platform) {
    const key = 'logo|' + (platform || '');
    if (!iconCache.has(key)) {
      iconCache.set(key, (async () => {
        try {
          const p = plat(platform), bmp = p.icon ? await local(p.icon) : await local('icons/brand-m.png');
          if (!bmp) return FALLBACK_ICON;
          const c = new OffscreenCanvas(ICON, ICON), x = c.getContext('2d');
          x.imageSmoothingQuality = 'high';
          x.save(); rr(x, 8, 8, ICON - 16, ICON - 16, 32); x.clip(); x.drawImage(bmp, 8, 8, ICON - 16, ICON - 16); x.restore();
          return await toDataUrl(c);
        } catch { return FALLBACK_ICON; }
      })());
    }
    return iconCache.get(key);
  }
  const MASK_FILE = { youtube: 'youtube', tiktok: 'tiktok', instagram: 'instagram', x: 'x', twitter: 'x', facebook: 'facebook', reddit: 'reddit', kick: 'kick' };
  const maskCache = new Map();
  function maskIcon(platform) {
    const file = MASK_FILE[platform] || 'ticket';
    if (!maskCache.has(file)) maskCache.set(file, (async () => {
      try {
        const m = (await local(`icons/masks/mask-${file}.png`)) || (await local('icons/brand-m.png'));
        if (!m) return null;
        const c = new OffscreenCanvas(32, 32), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(m, 0, 0, 32, 32);
        x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, 32, 32);
        return await toDataUrl(c);
      } catch { return null; }
    })());
    return maskCache.get(file);
  }

  function basic(o) { return Object.assign({ type: 'basic', priority: 0, contextMessage: BRAND, iconUrl: FALLBACK_ICON }, o); }
  async function withIcon(out, work, platform) {
    if (IS_FIREFOX) return out;
    try {
      const [icon, mask] = await withTimeout(Promise.all([work(), maskIcon(platform)]), ART_MS);
      if (icon) out.iconUrl = icon;
      if (mask) out.appIconMaskUrl = mask;
    } catch {   }
    return out;
  }
  const reward = (n) => (n > 0 ? `+${n} ticket${n === 1 ? '' : 's'}` : 'Earn tickets');

  const HINT_KEY = 'toastHintSeen';
  async function firstTime(key) {
    try {
      const st = chrome.storage && chrome.storage.local;
      if (!st) return true;
      const got = await st.get(HINT_KEY);
      const seen = (got && got[HINT_KEY]) || {};
      if (seen[key]) return false;
      seen[key] = Date.now();
      await st.set({ [HINT_KEY]: seen });
      return true;
    } catch { return true; }
  }

  async function target(t) {
    const n = num(t.reward), left = timeLeft(t.expiresAt), thing = await thingFor(t);
    const hint = await firstTime(TICKET_FILE[t.platform] || 'other');
    const out = basic({
      title: `${reward(n)}: new ${thing}`,
      message: hint ? `${todo(t)} to collect your tickets.` : '',
      contextMessage: ctx(left ? left.text : null),
    });
    return withIcon(out, () => ticketIcon(n, t.platform), t.platform);
  }

  async function targets(list) {
    const items = (Array.isArray(list) ? list : [list]).filter(Boolean);
    if (items.length === 0) return basic({ title: 'New posts from Mizkif', message: 'Click to see them.' });
    if (items.length === 1) return target(items[0]);
    const rows = await Promise.all(items.map(async (t) => ({ t, p: plat(t.platform), n: num(t.reward), thing: await thingFor(t), step: todo(t) })));
    const total = rows.reduce((s, r) => s + r.n, 0);
    const soonest = rows.map((r) => timeLeft(r.t.expiresAt)).filter(Boolean).sort((a, b) => a.ms - b.ms)[0];
    const lines = rows.slice(0, 3).map((r) => `${r.n > 0 ? `+${r.n} ` : ''}${r.thing}`);
    if (rows.length > 3) lines.push(`+ ${rows.length - 3} more`);
    const buttons = [{ title: rows[0].p.btn }];
    if (rows[1] && rows[1].p.btn !== buttons[0].title) buttons.push({ title: rows[1].p.btn });
    const out = basic({
      title: `${reward(total)}: ${rows.length} new posts`,
      message: lines.join(' · '),
      contextMessage: ctx(soonest ? soonest.text : null),
      buttons,
    });
    return withIcon(out, () => ticketIcon(total, null), null);
  }

  async function live() {
    const hint = await firstTime('kick');
    const out = basic({ title: '🔴 Mizkif is live on Kick', message: hint ? 'Watch and vote to collect tickets.' : '', contextMessage: ctx('Kick'), priority: 2 });
    return withIcon(out, () => logoIcon('kick'), 'kick');
  }

  function hostPlatform(url) {
    try {
      const h = new URL(String(url)).hostname.replace(/^www\.|^m\./, '');
      if (h.endsWith('youtube.com') || h === 'youtu.be') return 'youtube';
      if (h.endsWith('tiktok.com')) return 'tiktok';
      if (h.endsWith('instagram.com')) return 'instagram';
      if (h === 'x.com' || h.endsWith('twitter.com')) return 'x';
      if (h.endsWith('facebook.com')) return 'facebook';
      if (h.endsWith('reddit.com')) return 'reddit';
      if (h.endsWith('kick.com')) return 'kick';
    } catch {   }
    return null;
  }
  async function push(d) {
    d = d || {};
    const platform = hostPlatform(d.url);
    const out = basic({
      title: cleanLine(d.title, 60) || BRAND,
      message: cleanLine(d.message, 160) || 'Click to open it.',
      contextMessage: ctx('Announcement'),
    });
    return withIcon(out, () => logoIcon(platform), platform);
  }

  async function social(d) {
    d = d || {};
    const p = plat(d.platform);
    const out = basic({
      title: p === GENERIC ? 'Mizkif posted something new' : `Mizkif posted on ${p.name}`,
      message: '',
      contextMessage: ctx(),
    });
    return withIcon(out, () => logoIcon(p === GENERIC ? null : d.platform), d.platform);
  }

  self.MGToast = {
    async build(kind, data) {
      try {
        if (kind === 'target') return await target(data || {});
        if (kind === 'targets') return await targets(data || []);
        if (kind === 'live') return await live(data || {});
        if (kind === 'push') return await push(data || {});
        if (kind === 'social') return await social(data || {});
      } catch {   }
      return basic({ title: BRAND, message: 'Something new from Mizkif. Click to open it.' });
    },
    firefox(o) {
      const list = Array.isArray(o) ? o : [o];
      const cut = list.map((t) => ({ type: 'basic', title: t.title, message: t.message, iconUrl: t.iconUrl }));
      return Array.isArray(o) ? cut : cut[0];
    },
  };
})();
