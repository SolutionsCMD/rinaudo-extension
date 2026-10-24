(function () {
  const RATES_URL = 'https://s2.jsolutions.dev/api/extension/rates';

  function add(parent, cls, text) {
    const n = document.createElement('div'); n.className = cls;
    if (text != null) n.textContent = text;
    parent.append(n); return n;
  }

  async function renderRates(el) {
    if (!el) return;
    let r;
    try { r = await (await fetch(RATES_URL)).json(); } catch { return; }
    if (!r || !r.watchVideo) return;
    const v = r.watchVideo;
    const cross = v.floor / v.perMinute;
    const crossStr = Number.isInteger(cross) ? String(cross) : cross.toFixed(1);
    const items = [
      {
        t: 'Watch the live stream', a: `${r.watchtimePerHour}→${r.watchtimeMaxPerHour}/hr`,
        d: `Rising +1/hr for each day in a row you show up, up to ${r.watchtimeMaxPerHour}/hr after a ${r.streakDays}-day streak. Miss a day and it resets to ${r.watchtimePerHour}.`,
      },
      {
        t: 'Watch his videos', a: `${v.floor}+`,
        d: `${v.floor} tickets for any video up to ${crossStr} minutes, then +${v.perMinute} for each extra minute, once per video.`,
        subs: [
          'YouTube: any video or short from the last 24h, plus his latest is always eligible.',
          'TikTok: any post from the last 24h.',
        ],
      },
      ...(r.like > 0 ? [{ t: 'Like a post', a: `+${r.like}`, d: 'Once per post, on his recent posts.' }] : []),
      ...(r.comment > 0 ? [{ t: 'Comment on a post', a: `+${r.comment}`, d: 'Once per post. Write a real sentence about the post.' }] : []),
      ...(r.commentLike > 0 && r.commentLikeMax > 0
        ? [{ t: 'Like a comment on a post', a: `+${r.commentLike} each`,
             d: `Up to ${r.commentLikeMax} comments per post, on YouTube, TikTok and X.` }]
        : []),
      { t: 'Vote in a poll', a: `+${r.vote}`, d: 'Each time you vote in a live poll.' },
      { t: 'Install bonus', a: `+${r.extensionInstall}`, d: 'One-time, for installing this extension.' },
    ];
    el.replaceChildren();
    add(el, 'rates-h', 'How tickets work');
    add(el, 'rates-intro', 'Connect with Kick first. Nothing credits until you do.');
    for (const it of items) {
      const item = add(el, 'rates-item');
      const row = add(item, 'rates-row');
      const l = document.createElement('span'); l.className = 'rates-l'; l.textContent = it.t;
      const a = document.createElement('span'); a.className = 'rates-amt'; a.textContent = it.a;
      row.append(l, a);
      if (it.d) add(item, 'rates-desc', it.d);
      for (const s of (it.subs || [])) add(item, 'rates-sub', s);
    }
    add(el, 'rates-note', r.commentLike > 0 && r.commentLikeMax > 0
      ? 'You earn on his recent posts only. Your ticket total shows in the corner of a post that counts. Each like, comment, and watch credits once per post. Comment likes credit up to the cap shown above.'
      : 'You earn on his recent posts only. Your ticket total shows in the corner of a post that counts. Each like, comment, and watch credits once per post.');
  }

  self.renderRates = renderRates;
})();
