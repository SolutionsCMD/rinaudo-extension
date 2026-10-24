const btn = document.getElementById('connect');
const btnLabel = document.getElementById('connectLabel');
const status = document.getElementById('status');
const connTitle = document.getElementById('connTitle');
const connectCard = document.getElementById('connectCard');

const { LINK_STYLE, svgIcon } = self.RGCBrand || { LINK_STYLE: {}, svgIcon: () => null };

try { document.getElementById('ver').textContent = 'Extension v' + chrome.runtime.getManifest().version; } catch {   }

try {
  const A = self.RGCGuideAssets || {};
  for (const img of document.querySelectorAll('img[data-asset]')) {
    const src = A[img.getAttribute('data-asset')];
    if (typeof src === 'string') img.src = src;
  }
} catch {   }

for (const el of document.querySelectorAll('[data-icon]')) {
  const svg = svgIcon(el.getAttribute('data-icon'));
  if (svg) el.append(svg);
}

try {
  if (new URLSearchParams(location.search).get('updated') === '1') {
    document.getElementById('eyebrow').textContent = 'New in this update';
    const title = document.getElementById('title');
    const em = document.createElement('em');
    em.textContent = 'Just follow the arrow.';
    title.replaceChildren('The extension now shows you what pays.', em);
    document.getElementById('lede').textContent = 'An arrow points at each thing that earns tickets on his posts, the eyes count your watch time, and your total sits in the corner.';
  }
} catch {   }

async function refresh() {
  const r = await chrome.runtime.sendMessage({ type: 's2AuthState' }).catch(() => ({ connected: false }));
  const on = !!(r && r.connected);
  connectCard.classList.toggle('on', on);
  connectCard.classList.toggle('needs', !on);
  btn.classList.toggle('pulse', !on);
  if (on) {
    connTitle.textContent = "Connected. You're all set.";
    status.textContent = 'Open any of his posts to start earning.';
    btnLabel.textContent = 'Connected';
    btn.disabled = true;
  } else {
    connTitle.textContent = 'Connect with Kick first';
    status.textContent = 'Not connected yet.';
    btnLabel.textContent = 'Connect with Kick';
    btn.disabled = false;
  }
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  await chrome.runtime.sendMessage({ type: 's2Connect' }).catch(() => null);
  refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.s2Token) refresh();
});

async function initGuideToggles() {
  const boxes = [...document.querySelectorAll('input[data-pref]')];
  const keys = boxes.map((b) => b.getAttribute('data-pref'));
  const got = await chrome.storage.local.get(keys).catch(() => ({}));
  for (const box of boxes) {
    const key = box.getAttribute('data-pref');
    box.checked = got[key] !== false;
    box.addEventListener('change', () => { chrome.storage.local.set({ [key]: box.checked }).catch(() => {}); });
  }
}

async function initNotifToggles() {
  const { notifPrefs } = await chrome.storage.local.get('notifPrefs').catch(() => ({}));
  const prefs = notifPrefs || {};
  for (const box of document.querySelectorAll('#notifs input[data-p]')) {
    const p = box.getAttribute('data-p');
    box.checked = prefs[p] !== false;
    box.addEventListener('change', async () => {
      const { notifPrefs: cur } = await chrome.storage.local.get('notifPrefs').catch(() => ({}));
      await chrome.storage.local.set({ notifPrefs: { ...(cur || {}), [p]: box.checked } }).catch(() => {});
    });
  }
}

function renderLinks() {
  const wrap = document.getElementById('links');
  const links = Array.isArray(self.MIZKIF_LINKS) ? self.MIZKIF_LINKS : [];
  wrap.replaceChildren();
  for (const l of links) {
    const style = LINK_STYLE[l.id] || [null, '#48d89f', 'Open'];
    const a = document.createElement('a');
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.setProperty('--platform', style[1]);
    const ic = document.createElement('span');
    ic.className = 'lic';
    const svg = style[0] ? svgIcon(style[0]) : null;
    if (svg) ic.append(svg);
    else { const img = document.createElement('img'); img.src = 'icons/brand-m.png'; img.alt = ''; ic.append(img); }
    const t = document.createElement('span');
    t.className = 'lt';
    const name = document.createElement('strong');
    name.textContent = l.label;
    const act = document.createElement('small');
    act.textContent = style[2];
    t.append(name, act);
    const go = document.createElement('span');
    go.className = 'go';
    go.setAttribute('aria-hidden', 'true');
    go.textContent = '→';
    a.append(ic, t, go);
    wrap.append(a);
  }
}

refresh();
initGuideToggles();
initNotifToggles();
renderLinks();
if (self.renderRates) renderRates(document.getElementById('rates'));
