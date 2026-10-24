const $ = (id) => document.getElementById(id);
const draftId = new URLSearchParams(location.search).get('d') || '';
let diag = null, shot = null, connected = false;

try { $('ver').textContent = 'Extension v' + chrome.runtime.getManifest().version; } catch {   }

const STEP = { watch: 'watch', replay: 'watch again', like: 'like', comment: 'comment', clike: 'comment likes', repost: 'repost', share: 'share', bonus: 'all-done bonus' };
const stepName = (id) => STEP[id] || id;
const PLATFORM = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', x: 'X', reddit: 'Reddit', kick: 'Kick' };
const ERRORS = {
  message_required: 'Tell us a little about what happened.',
  kick_name_required: 'Add your Kick name so we can look you up.',
  rate_limited: "You've sent a few reports already. Try again in an hour.",
  bad_screenshot: "The screenshot couldn't be sent. Untick it and try again.",
  network: "Couldn't reach us. Check your connection and try again.",
};

function li(label, value) {
  const el = document.createElement('li');
  const b = document.createElement('b');
  b.textContent = label + ': ';
  el.append(b, String(value));
  return el;
}

function renderSummary() {
  const ul = $('sum');
  ul.replaceChildren();
  const d = diag || {};
  const e = d.ext || {}, b = e.browser || {}, c = d.conn || {}, p = d.page || null;
  if (p && p.platform) {
    const where = (PLATFORM[p.platform] || p.platform) + (p.ref ? ' post ' + p.ref : ' page');
    ul.append(li('Page', where));
    if (Array.isArray(p.steps) && p.steps.length) {
      const done = p.steps.filter((s) => s.done).map((s) => stepName(s.id));
      const open = p.steps.filter((s) => !s.done && !s.voided).map((s) => stepName(s.id));
      ul.append(li('Steps', (done.length ? 'done ' + done.join(', ') : 'none done') + (open.length ? '; open ' + open.join(', ') : '')));
    }
  } else {
    ul.append(li('Page', 'not on one of his posts'));
  }
  ul.append(li('Extension', [e.version, [b.name, b.ver].filter(Boolean).join(' '), e.os].filter(Boolean).join(', ')));
  const acct = [c.connected ? 'connected' : 'not connected'];
  if (typeof c.tickets === 'number') acct.push(c.tickets.toLocaleString('en-US') + ' tickets');
  if (c.canEarn === false) acct.push('earning blocked (no Kick link)');
  ul.append(li('Account', acct.join(', ')));
  const n = Array.isArray(d.activity) ? d.activity.length : 0;
  ul.append(li('Recent requests', n ? `the last ${n} the extension made, and what the server answered` : 'none yet'));
  $('all').textContent = JSON.stringify(d, null, 2);
}

function renderTips() {
  const d = diag || {};
  const u = d.update;
  if (u && u.available) {
    $('updTip').hidden = false;
    $('updText').textContent = u.latest ? `Version ${u.latest} is out and you have ${d.ext && d.ext.version}. Update from the extension menu, then try again.` : 'A newer version is out. Update from the extension menu, then try again.';
  }
  const p = d.page;
  if (p && p.platform === 'tiktok' && Array.isArray(p.steps) && p.steps.some((s) => s.id === 'repost' && !s.done)) {
    const n = $('refreshNote');
    n.hidden = false;
    n.textContent = ' A TikTok repost that TikTok accepted is usually paid right after a refresh.';
  }
}

async function load() {
  const [dr, pf] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'bugDraft', id: draftId }).catch(() => null),
    chrome.runtime.sendMessage({ type: 'bugPrefill' }).catch(() => null),
  ]);
  diag = (dr && dr.diag) || {};
  shot = dr && typeof dr.shot === 'string' ? dr.shot : null;
  connected = !!(pf && pf.connected);
  if (pf && pf.kick) $('kick').value = pf.kick;
  $('kickHint').textContent = connected ? 'So we can look you up. Filled in from your account.' : 'Required, since the extension is not connected. So we can look you up.';
  if (shot) {
    $('shotField').hidden = false;
    $('shotImg').src = shot;
    $('shotOn').addEventListener('change', () => $('shotBox').classList.toggle('on', $('shotOn').checked));
  }
  renderSummary();
  renderTips();
  $('msg').focus();
}

$('send').addEventListener('click', async () => {
  const message = $('msg').value.trim();
  const kickName = $('kick').value.trim().replace(/^@+/, '');
  $('err').textContent = '';
  if (message.length < 3) { $('err').textContent = ERRORS.message_required; $('msg').focus(); return; }
  if (!connected && !kickName) { $('err').textContent = ERRORS.kick_name_required; $('kick').focus(); return; }
  const btn = $('send');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  const r = await chrome.runtime.sendMessage({
    type: 'bugSubmit', draftId, message, kickName: kickName || null, diag,
    screenshot: shot && $('shotOn').checked ? shot : null,
  }).catch(() => null);
  if (r && r.ok) {
    $('form').hidden = true;
    $('done').hidden = false;
    $('doneText').textContent = r.id ? `Report #${r.id}. We'll look into it.` : "We'll look into it.";
    return;
  }
  btn.disabled = false;
  btn.textContent = 'Send report';
  const code = (r && r.error) || 'network';
  $('err').textContent = ERRORS[code] || "Couldn't send the report. Try again in a minute.";
});

$('closeBtn').addEventListener('click', () => {
  try { window.close(); } catch {   }
});

load();
