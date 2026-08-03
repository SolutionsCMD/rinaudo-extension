// Shared stake panel — the stake-on-a-ticker poll, mirrored 1:1 from the live
// desk (DeskLive.tsx): ticker picks with live tallies, the ticket-pile slider,
// and the 10% pool-cap tick with the over-cap refund warning during the join
// window. Used by the vote popup (vote/vote.html) and the Kick on-page card
// (content/kick.js). Exposes a single global:
//   self.RGCStake.render(host, data, actions) -> bool (true when a round panel
//   was rendered — callers fall back to their poll UI when it returns false)
//   self.RGCStake.CSS -> styles to inject (popup <style> tag / frame css param)
// data:    { round, me, connected } from the SW's s2Round message
// actions: { nominate(ticker), stake(ticker, amount), join(amount) }
self.RGCStake = (function () {
  // Ticket sprites, same assets as the desk.
  const SITE = 'https://mizkif.com';
  const tix = (i) => `${SITE}/uploads/site/ticket-${i % 8}.svg`;

  const CSS = `
    .stkQ{font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:1.15rem;color:#F4EFE3;margin:0 0 12px;line-height:1.2}
    .stkMeta{font-family:ui-monospace,'JetBrains Mono',monospace;font-size:10.5px;color:#9FA6B0;margin-bottom:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .stkMeta b{color:#E2C685;font-weight:600}
    .stkMeta img{width:13px;height:13px;vertical-align:-2px}
    .stkTk{font-family:ui-monospace,'JetBrains Mono',monospace;font-weight:600;font-size:20px;color:#E2C685;letter-spacing:.02em}
    .stkCo{font-size:11px;color:#9FA6B0;margin:1px 0 10px}
    .stkRule{height:1px;background:rgba(201,167,102,.16);margin:10px 0 12px}
    .stkOpts{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
    .stkOpt{position:relative;display:flex;align-items:center;gap:10px;width:100%;padding:12px 14px;border:1px solid rgba(244,239,227,.1);border-radius:7px;background:rgba(255,255,255,.015);color:#F4EFE3;cursor:pointer;overflow:hidden;text-align:left;font:inherit;transition:border-color .2s}
    .stkOpt:hover{border-color:rgba(201,167,102,.4)}
    .stkOpt.sel{border-color:#C9A766}
    .stkOpt .fill{position:absolute;left:0;top:0;bottom:0;z-index:0;background:linear-gradient(90deg,rgba(201,167,102,.20),rgba(201,167,102,.05));transition:width .35s}
    .stkOpt .tk{position:relative;z-index:1;flex:1;font-family:ui-monospace,'JetBrains Mono',monospace;font-weight:600;font-size:14px}
    .stkOpt.sel .tk::before{content:'✓ ';color:#86D6A4}
    .stkOpt .cnt{position:relative;z-index:1;font-family:ui-monospace,'JetBrains Mono',monospace;font-size:12px;color:#9FA6B0;font-variant-numeric:tabular-nums}
    .stkSlider{margin:4px 0 6px}
    .stkPile{position:relative;height:44px;margin-bottom:2px}
    .stkPile img{position:absolute;width:26%;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
    .stkRangeWrap{position:relative;padding:0 24px}
    .stkRange{-webkit-appearance:none;appearance:none;width:100%;height:8px;border-radius:999px;outline:none;cursor:pointer}
    .stkRange::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;border-radius:50%;background:#F4EFE3;border:2px solid #C8552A;box-shadow:0 1px 4px rgba(0,0,0,.5)}
    .stkRange::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#F4EFE3;border:2px solid #C8552A;box-shadow:0 1px 4px rgba(0,0,0,.5)}
    .stkRange:disabled{opacity:.45;cursor:default}
    .stkThumb{position:absolute;top:-26px;transform:translateX(-50%);font-family:ui-monospace,'JetBrains Mono',monospace;font-weight:600;font-size:13px;color:#F4EFE3;background:#A84420;border-radius:7px;padding:1px 8px;pointer-events:none;white-space:nowrap}
    .stkThumb.over{background:#7A1E12;color:#FFD9CF}
    .stkCapTick{position:absolute;top:-30px;transform:translateX(-50%);pointer-events:none;white-space:nowrap}
    .stkCapTick i{font-style:normal;font-family:ui-monospace,'JetBrains Mono',monospace;font-size:9px;color:#E8B339;background:rgba(232,179,57,.12);border:1px solid rgba(232,179,57,.4);border-radius:6px;padding:1px 6px}
    .stkCapTick::after{content:'';display:block;width:1px;height:22px;background:rgba(232,179,57,.55);margin:2px auto 0}
    .stkCapHint{min-height:16px;font-size:11px;color:#E8B339;margin:2px 0 8px;text-align:center}
    .stkBig{width:100%;padding:14px;border:0;border-radius:9px;background:linear-gradient(180deg,#C8552A,#A84420);color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:.01em}
    .stkBig:disabled{opacity:.45;cursor:default}
    .stkNote{font-size:11.5px;color:#9FA6B0;margin-top:8px;text-align:center}
    .stkHint{font-family:ui-monospace,'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.08em;color:#6E6B60;text-transform:uppercase;margin-top:10px;text-align:center}
    .stkSugg{display:flex;gap:8px;margin-bottom:12px}
    .stkSugg input{flex:1;padding:11px 13px;border-radius:8px;border:1px solid rgba(244,239,227,.14);background:rgba(255,255,255,.03);color:#F4EFE3;font:inherit;font-size:14px;text-transform:uppercase;outline:none}
    .stkSugg input:focus{border-color:rgba(201,167,102,.5)}
    .stkSugg button{padding:11px 16px;border:0;border-radius:8px;background:linear-gradient(180deg,#C8552A,#A84420);color:#fff;font:inherit;font-weight:700;cursor:pointer}`;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ── 1:1 desk slider math (DeskLive TicketSlider): when a cap exists, tickets
  // 1..cap span the first 3/4 of the track (fine control where it matters) and
  // cap..max compress into the last 1/4 — the cap tick always sits at 75%.
  const KNEE = 0.75, POS_MAX = 1000;
  const toPos = (val, safeMax, showCap, capAt) => {
    if (!showCap) return (val - 1) / Math.max(1, safeMax - 1);
    return val <= capAt
      ? (KNEE * (val - 1)) / Math.max(1, capAt - 1)
      : KNEE + ((1 - KNEE) * (val - capAt)) / Math.max(1, safeMax - capAt);
  };
  const toVal = (pos, safeMax, showCap, capAt) => {
    if (!showCap) return Math.round(1 + pos * (safeMax - 1));
    return pos <= KNEE
      ? Math.round(1 + (pos / KNEE) * (capAt - 1))
      : Math.round(capAt + ((pos - KNEE) / (1 - KNEE)) * (safeMax - capAt));
  };

  // Compact deterministic ticket pile using the desk's sprites — the pile IS
  // your stake, ticket for ticket (capped at 24 sprites so huge piles stay cheap).
  function renderPile(host, count) {
    host.replaceChildren();
    const n = Math.min(24, Math.max(0, count));
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 8), col = i % 8;
      const img = document.createElement('img');
      img.src = tix(i);
      img.alt = '';
      img.style.left = `${3 + col * 12 + ((i * 37) % 7) - 3}%`;
      img.style.bottom = `${row * 12}px`;
      img.style.transform = `rotate(${((i * 53) % 25) - 12}deg)`;
      img.style.zIndex = String(30 - row);
      host.append(img);
    }
  }

  // The slider assembly. onInput(n) fires with the committed ticket value.
  function slider({ max, value, capAt, disabled, onInput }) {
    const safeMax = Math.max(1, max);
    let v = Math.min(Math.max(1, value), safeMax);
    const showCap = capAt != null && capAt >= 2 && capAt < safeMax;

    const wrap = el('div', 'stkSlider');
    const pile = el('div', 'stkPile');
    const rangeWrap = el('div', 'stkRangeWrap');
    const range = document.createElement('input');
    range.type = 'range'; range.min = '0'; range.max = String(POS_MAX); range.step = '1';
    range.className = 'stkRange';
    if (disabled) range.disabled = true;
    const thumb = el('span', 'stkThumb');
    const hint = el('div', 'stkCapHint');

    const paint = () => {
      const pos = toPos(v, safeMax, showCap, capAt);
      const pct = pos * 100;
      range.value = String(Math.round(pos * POS_MAX));
      range.style.background = `linear-gradient(90deg, #C8552A ${pct}%, #F1E8D2 ${pct}%)`;
      thumb.textContent = String(v);
      thumb.style.left = `calc(24px + (100% - 48px) * ${pct / 100})`;
      const overCap = showCap && v > capAt;
      thumb.classList.toggle('over', overCap);
      // 1:1 desk over-cap warning: the extra would come back as a refund
      hint.textContent = overCap ? `past the cap — the extra ~${v - capAt} would come back as a refund` : ' ';
      renderPile(pile, v);
    };
    range.addEventListener('input', () => {
      v = Math.max(1, Math.min(safeMax, toVal(Number(range.value) / POS_MAX, safeMax, showCap, capAt)));
      paint();
      onInput(v);
    });

    if (showCap) {
      const tick = el('span', 'stkCapTick');
      tick.style.left = `calc(24px + (100% - 48px) * ${KNEE})`;
      const label = el('i', '', `10% cap · ${capAt}`);
      label.title = `≈ the 10% pool cap right now — anything past ${capAt} is refunded once the buy goes through`;
      tick.append(label);
      rangeWrap.append(tick);
    }
    rangeWrap.append(range, thumb);
    wrap.append(pile, rangeWrap, hint);
    paint();
    return { wrap, get value() { return v; } };
  }

  function optionRow(ticker, amount, total, selected, onPick) {
    const b = el('button', 'stkOpt' + (selected ? ' sel' : ''));
    b.type = 'button';
    const fill = el('span', 'fill');
    fill.style.width = (total > 0 ? Math.round((amount / total) * 100) : 0) + '%';
    b.append(fill, el('span', 'tk', ticker), el('span', 'cnt', amount.toLocaleString()));
    b.addEventListener('click', onPick);
    return b;
  }

  // data: {round, me, connected}; actions: {nominate, stake, join}. Returns
  // true when a round panel rendered (caller should skip its poll UI).
  function render(host, data, actions) {
    const round = data && data.round;
    if (!round) return false;
    const me = data.me || null;
    const connected = !!data.connected;
    host.replaceChildren();

    // ── nominating: free suggestion box ─────────────────────────────────────
    if (round.status === 'nominating') {
      host.append(el('div', 'stkQ', 'Suggest a ticker'));
      const row = el('div', 'stkSugg');
      const input = document.createElement('input');
      input.maxLength = 8; input.placeholder = connected ? 'e.g. NVDA' : 'connect to suggest';
      input.disabled = !connected;
      const go = el('button', '', 'Suggest');
      const submit = () => {
        const t = input.value.trim().toUpperCase();
        if (!/^[A-Z]{1,8}$/.test(t)) return;
        input.value = '';
        actions.nominate(t);
      };
      go.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      row.append(input, go);
      host.append(row);
      const tally = (round.tally || []).slice(0, 8);
      if (tally.length) {
        const total = tally.reduce((a, x) => a + x.amount, 0);
        const opts = el('div', 'stkOpts');
        tally.forEach((t) => opts.append(optionRow(t.ticker, t.amount, total, false, () => { input.value = t.ticker; })));
        host.append(opts);
      }
      host.append(el('div', 'stkHint', 'Suggesting is free · the desk picks from the room’s list next'));
      return true;
    }

    // ── staking: pick a ticker + slide tickets ──────────────────────────────
    if (round.status === 'staking') {
      const tally = round.tally || [];
      const total = tally.reduce((a, x) => a + x.amount, 0);
      const mine = me && me.stake;
      host.append(el('div', 'stkQ', 'Stake tickets on a ticker'));
      const meta = el('div', 'stkMeta');
      meta.append(document.createTextNode(`${total.toLocaleString()} staked`));
      if (me) {
        const held = el('b', '', ` · ${me.tickets.toLocaleString()} held`);
        meta.append(held);
      }
      host.append(meta);

      let sel = mine ? mine.ticker : (tally[0] && tally[0].ticker) || null;
      const opts = el('div', 'stkOpts');
      const redrawOpts = () => {
        opts.replaceChildren();
        tally.forEach((t) => opts.append(optionRow(t.ticker, t.amount, total, t.ticker === sel, () => { sel = t.ticker; redrawOpts(); })));
      };
      redrawOpts();
      host.append(opts);

      // Replacing a stake refunds the old one first (engine setStake), so the
      // slideable pile is current tickets + whatever is already staked.
      const maxT = (me ? me.tickets : 0) + (mine ? mine.amount : 0);
      let amount = Math.min(25, Math.max(1, maxT));
      const big = el('button', 'stkBig');
      const paintBig = () => { big.textContent = sel ? `Stake ${amount} 🎟 on ${sel}` : 'Pick a ticker'; };
      const sl = slider({
        max: Math.max(1, maxT), value: amount, capAt: null,
        disabled: !connected || !me || maxT < 1,
        onInput: (n) => { amount = n; paintBig(); },
      });
      host.append(sl.wrap);
      paintBig();
      big.disabled = !connected || !me || maxT < 1 || !sel;
      big.addEventListener('click', () => { if (sel) actions.stake(sel, amount); });
      host.append(big);
      if (mine) host.append(el('div', 'stkNote', `You have ${mine.amount.toLocaleString()} on ${mine.ticker} — staking moves it`));
      else if (me && maxT < 1) host.append(el('div', 'stkNote', 'You have no tickets to stake'));
      host.append(el('div', 'stkHint', 'Most-staked ticker becomes the desk’s pick'));
      return true;
    }

    // ── joining: the desk's pick is set — slide how many tickets to add ─────
    if (round.status === 'joining') {
      const t0 = (round.tally || [])[0] || { ticker: round.winningTicker || '—', amount: 0 };
      const committed = t0.amount;
      const myCommitted = me ? me.committed : 0;
      host.append(el('div', 'stkTk', t0.ticker), el('div', 'stkCo', 'The desk’s pick'));
      const meta = el('div', 'stkMeta');
      const img = document.createElement('img'); img.src = tix(0); img.alt = '';
      meta.append(img, document.createTextNode(`${committed.toLocaleString()} committed`));
      if (me) meta.append(el('b', '', ` · ${me.tickets.toLocaleString()} held`));
      host.append(meta, el('div', 'stkRule'));
      host.append(el('div', 'stkQ', 'Step 2 — Slide how many tickets to add.'));

      const tickets = me ? me.tickets : 0;
      if (connected && me && tickets < 1) {
        host.append(el('div', 'stkNote', 'You have no tickets left to add.'));
      } else {
        // 1:1 desk cap estimate: my slice can be at most 10% of the final pot,
        // so cap = (committed so far − my committed) / 9.
        const capAt = Math.floor(Math.max(0, committed - myCommitted) / 9);
        let amount = Math.min(25, Math.max(1, tickets));
        const big = el('button', 'stkBig');
        const paintBig = () => { big.textContent = `Join with ${Math.min(amount, Math.max(1, tickets))} 🎟`; };
        const sl = slider({
          max: Math.max(1, tickets), value: amount, capAt,
          disabled: !connected || !me,
          onInput: (n) => { amount = n; paintBig(); },
        });
        host.append(sl.wrap);
        paintBig();
        big.disabled = !connected || !me;
        big.addEventListener('click', () => actions.join(Math.min(amount, Math.max(1, tickets))));
        host.append(big);
      }
      host.append(el('div', 'stkHint', 'Final window · profit splits by ticket share when the desk sells'));
      return true;
    }

    return false; // live/settled — nothing to do here
  }

  return { render, CSS };
})();
