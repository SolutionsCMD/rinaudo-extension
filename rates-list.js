// Shared "How to earn" list — fetches the live earning rates and renders them into
// a container. Used by the popup and the on-install welcome page. The host page
// supplies the .rates-* CSS. textContent only (never innerHTML with fetched data).
(function () {
  const RATES_URL = 'https://s2.jsolutions.dev/api/extension/rates';

  async function renderRates(el) {
    if (!el) return;
    let r;
    try { r = await (await fetch(RATES_URL)).json(); } catch { return; }
    if (!r || !r.watchVideo) return;
    const rows = [
      ['Watch the stream', `${r.watchtimePerHour}→${r.watchtimeMaxPerHour}/hr`],
      ['Watch a video', `${r.watchVideo.floor}+`],
      ['Like a post', `+${r.like}`],
      ['Comment (>5 chars)', `+${r.comment}`],
      ['Vote in a poll', `+${r.vote}`],
      ['Install bonus', `+${r.extensionInstall}`],
    ];
    el.replaceChildren();
    const h = document.createElement('div'); h.className = 'rates-h'; h.textContent = 'How to earn tickets';
    el.append(h);
    for (const [label, amt] of rows) {
      const row = document.createElement('div'); row.className = 'rates-row';
      const l = document.createElement('span'); l.className = 'rates-l'; l.textContent = label;
      const a = document.createElement('span'); a.className = 'rates-amt'; a.textContent = amt;
      row.append(l, a); el.append(row);
    }
    const note = document.createElement('div'); note.className = 'rates-note';
    note.textContent = 'Earn on his latest posts — X, YouTube, TikTok & Instagram.';
    el.append(note);
  }

  self.renderRates = renderRates;
})();
