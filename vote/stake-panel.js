// Shared stake panel — the stake-on-a-ticker poll, mirrored 1:1 from the live
// desk (DeskLive.tsx): ticker picks with live tallies, the ticket-pile slider,
// and the 5% pool-cap tick with the over-cap refund warning during the join
// window. Used by the Kick on-page card (content/kick.js); it also backed the
// detached vote window until that was retired in 1.127. Exposes a single global:
//   self.RGCStake.render(host, data, actions) -> bool (true when a round panel
//   was rendered — callers fall back to their poll UI when it returns false)
//   self.RGCStake.CSS -> styles to inject (frame css param)
// data:    { round, me, connected } from the SW's s2Round message
// actions: { stake(ticker, amount), join(amount) }  (nominate is unused: the
//          suggestion box was removed permanently)
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
    .stkPile{position:relative;height:52px;margin-bottom:2px;overflow:hidden}
    .stkPile img{position:absolute;width:21%;filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))}
    /* Typed amount + hold-to-repeat arrows. Replaced the drag slider: people kept
       overshooting it and committing the wrong number of tickets. */
    .stkStep{display:flex;align-items:stretch;gap:8px;margin:2px 0 6px}
    .stkStep input{flex:1;min-width:0;padding:12px 14px;border-radius:9px;border:1px solid rgba(244,239,227,.16);background:rgba(255,255,255,.04);color:#F4EFE3;font-family:ui-monospace,'JetBrains Mono',monospace;font-size:20px;font-weight:600;text-align:center;outline:none;-moz-appearance:textfield}
    .stkStep input::-webkit-outer-spin-button,.stkStep input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
    .stkStep input:focus{border-color:rgba(201,167,102,.55)}
    .stkStep input:disabled{opacity:.45}
    .stkStep button{width:52px;flex:none;border:1px solid rgba(244,239,227,.16);border-radius:9px;background:rgba(255,255,255,.05);color:#F4EFE3;font:inherit;font-size:20px;font-weight:700;cursor:pointer;line-height:1;user-select:none;-webkit-user-select:none;touch-action:manipulation}
    .stkStep button:hover:not(:disabled){background:rgba(255,255,255,.1)}
    .stkStep button:active:not(:disabled){background:rgba(200,85,42,.35)}
    .stkStep button:disabled{opacity:.35;cursor:default}
    .stkQuick{display:flex;gap:6px;margin:0 0 8px}
    .stkQuick button{flex:1;padding:7px 0;border:1px solid rgba(244,239,227,.14);border-radius:7px;background:rgba(255,255,255,.03);color:#C9D2DC;font:inherit;font-size:11.5px;cursor:pointer}
    .stkQuick button:hover:not(:disabled){background:rgba(255,255,255,.08);color:#F4EFE3}
    .stkQuick button:disabled{opacity:.35;cursor:default}
    .stkCapHint{min-height:16px;font-size:11px;color:#E8B339;margin:2px 0 8px;text-align:center}
    /* Post-placement confirmation: the button dulls for a few seconds so it is
       obvious the stake landed and a second click cannot go in by accident. */
    .stkBig.placed{background:linear-gradient(180deg,#3E4A3C,#2F3A2E);color:#BFD8B4;cursor:default;opacity:1}
    .stkPot{margin:8px 0 0;padding:9px 11px;border-radius:8px;background:rgba(226,198,133,.08);border:1px solid rgba(226,198,133,.28);font-family:ui-monospace,'JetBrains Mono',monospace;font-size:12px;color:#E2C685;text-align:center}
    .stkPot b{font-size:15px;font-weight:700}
    .stkBig{width:100%;padding:14px;border:0;border-radius:9px;background:linear-gradient(180deg,#C8552A,#A84420);color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:.01em}
    .stkBig:disabled{opacity:.45;cursor:default}
    .stkNote{font-size:11.5px;color:#9FA6B0;margin-top:8px;text-align:center}
    .stkHint{font-family:ui-monospace,'JetBrains Mono',monospace;font-size:9.5px;letter-spacing:.08em;color:#6E6B60;text-transform:uppercase;margin-top:10px;text-align:center}`;

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
    const n = Math.min(16, Math.max(0, count));
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 8), col = i % 8;
      const img = document.createElement('img');
      img.src = tix(i);
      img.alt = '';
      img.style.left = `${3 + col * 12 + ((i * 37) % 7) - 3}%`;
      img.style.bottom = `${row * 14}px`;
      img.style.transform = `rotate(${((i * 53) % 25) - 12}deg)`;
      img.style.zIndex = String(30 - row);
      host.append(img);
    }
  }

  // Typed amount control. Same interface the slider had ({wrap, value}) so the
  // render branches below did not have to change shape.
  //
  // Why not a slider: dragging to an exact number is fiddly, and overshooting it
  // commits the wrong number of TICKETS, which people were doing repeatedly. Typing
  // is exact, the arrows step by one, and holding an arrow repeats (accelerating)
  // for quickly walking a value up or down.
  function amountInput({ max, value, capAt, disabled, onInput }) {
    const safeMax = Math.max(1, max);
    let v = Math.min(Math.max(1, value), safeMax);

    const wrap = el('div', 'stkSlider');
    const pile = el('div', 'stkPile');
    const row = el('div', 'stkStep');
    const minus = el('button', '', '\u2212');
    const plus = el('button', '', '+');
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.setAttribute('aria-label', 'tickets');
    const hint = el('div', 'stkCapHint');

    minus.type = 'button'; plus.type = 'button';
    if (disabled) { minus.disabled = true; plus.disabled = true; input.disabled = true; }

    const paint = () => {
      if (document.activeElement !== input) input.value = String(v);
      minus.disabled = disabled || v <= 1;
      plus.disabled = disabled || v >= safeMax;
      const overCap = capAt != null && capAt >= 2 && capAt < safeMax && v > capAt;
      hint.textContent = overCap
        ? `past the cap, the extra ~${v - capAt} would come back as a refund`
        : (v >= safeMax ? `that is all ${safeMax.toLocaleString()} of your tickets` : ' ');
      renderPile(pile, v);
    };
    // `force` writes the value into the field even while it has focus. paint() normally
    // refuses to do that so it can't fight someone mid-keystroke, but the arrow keys
    // fire WHILE the field is focused and must move the visible number.
    const setV = (n, force) => {
      const next = Math.max(1, Math.min(safeMax, Math.floor(n) || 1));
      const changed = next !== v;
      v = next;
      paint();
      if (force) input.value = String(v);
      if (changed) onInput(v);
    };

    // Hold-to-repeat: 400ms before the first repeat, then accelerating 120ms -> 30ms.
    let holdT = null, holdI = null;
    const stopHold = () => { clearTimeout(holdT); clearInterval(holdI); holdT = holdI = null; };
    const startHold = (dir) => {
      stopHold();
      holdT = setTimeout(() => {
        let step = 1, ticks = 0;
        holdI = setInterval(() => {
          ticks++;
          if (ticks > 12) step = 5;
          if (ticks > 30) step = 25;
          setV(v + dir * step);
          if ((dir < 0 && v <= 1) || (dir > 0 && v >= safeMax)) stopHold();
        }, 60);
      }, 400);
    };
    [[minus, -1], [plus, 1]].forEach(([btn, dir]) => {
      btn.addEventListener('click', () => setV(v + dir));
      btn.addEventListener('pointerdown', () => { if (!btn.disabled) startHold(dir); });
      ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach((e) => btn.addEventListener(e, stopHold));
    });

    // Let them type freely, only clamping on blur/Enter so backspacing to empty
    // does not fight them mid-edit.
    input.addEventListener('input', () => {
      const digits = input.value.replace(/[^0-9]/g, '');
      if (input.value !== digits) input.value = digits;
      if (digits === '') return;
      const n = Math.max(1, Math.min(safeMax, Number(digits)));
      if (n !== v) { v = n; onInput(v); }
      minus.disabled = disabled || v <= 1;
      plus.disabled = disabled || v >= safeMax;
      renderPile(pile, v);
    });
    input.addEventListener('blur', () => setV(Number(input.value.replace(/[^0-9]/g, '')) || 1));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { e.preventDefault(); setV(v + (e.shiftKey ? 10 : 1), true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setV(v - (e.shiftKey ? 10 : 1), true); }
      else if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });

    row.append(minus, input, plus);

    // Quick amounts — the common picks without typing.
    const quick = el('div', 'stkQuick');
    [['10', 10], ['25', 25], ['100', 100], ['All', safeMax]].forEach(([label, n]) => {
      const b = el('button', '', label);
      b.type = 'button';
      b.disabled = disabled || n > safeMax;
      b.addEventListener('click', () => setV(n));
      quick.append(b);
    });

    wrap.append(pile, row, quick, hint);
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

  // The caller re-renders this panel on every poll tick (~5s) and render() starts by
  // wiping `host`, so the slider is rebuilt from scratch each time. Seeding it from a
  // constant meant a viewer's chosen amount snapped back to 25 a few seconds after they
  // set it. Remember their pick here instead, keyed to the round AND phase so it survives
  // the rebuilds but resets on a new round or when staking moves to the final window.
  let picked = { key: null, amount: 0 };
  const pickKey = (round) => `${round.id}:${round.status}`;
  // Their remembered amount, clamped to what they can actually afford now (their ticket
  // balance can drop between rebuilds), or `fallback` if they haven't touched it yet.
  function seedAmount(round, fallback, max) {
    const remembered = picked.key === pickKey(round) ? picked.amount : 0;
    return remembered > 0 ? Math.max(1, Math.min(remembered, max)) : fallback;
  }
  function remember(round, n) { picked = { key: pickKey(round), amount: n }; }

  // After a stake lands, dull the button for a few seconds. Two jobs: it is visible
  // confirmation that the click registered, and it makes an accidental second
  // commit impossible during the window where someone would double-click.
  const PLACED_MS = 5000;
  function markPlaced(btn, label) {
    btn.disabled = true;
    btn.classList.add('placed');
    const original = btn.textContent;
    btn.textContent = label;
    setTimeout(() => {
      // The panel is rebuilt on every poll tick, so this button is usually gone by
      // now; only restore it if it is somehow still on screen.
      if (!btn.isConnected) return;
      btn.classList.remove('placed');
      btn.textContent = original;
      btn.disabled = false;
    }, PLACED_MS);
  }

  // How many of MY tickets are already in this round's pot.
  function potLine(n) {
    const d = el('div', 'stkPot');
    d.append(document.createTextNode('You have '), el('b', '', `${n.toLocaleString()} 🎟`), document.createTextNode(' in the pot'));
    return d;
  }

  // data: {round, me, connected}; actions: {stake, join}. Returns
  // true when a round panel rendered (caller should skip its poll UI).
  function render(host, data, actions) {
    const round = data && data.round;
    if (!round) return false;
    const me = data.me || null;
    const connected = !!data.connected;
    host.replaceChildren();

    // ── nominating ───────────────────────────────────────────────────────────
    // The suggestion box is GONE, permanently, at the owner's instruction: a round
    // sits in 'nominating' for hours, so it put a card on screen almost all the time
    // and kept reappearing whenever a vote started. Nothing renders in this phase.
    if (round.status === 'nominating') return false;

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
      let amount = seedAmount(round, Math.min(25, Math.max(1, maxT)), Math.max(1, maxT));
      const big = el('button', 'stkBig');
      const paintBig = () => { big.textContent = sel ? `Stake ${amount} 🎟 on ${sel}` : 'Pick a ticker'; };
      const sl = amountInput({
        max: Math.max(1, maxT), value: amount, capAt: null,
        disabled: !connected || !me || maxT < 1,
        onInput: (n) => { amount = n; remember(round, n); paintBig(); },
      });
      host.append(sl.wrap);
      paintBig();
      big.disabled = !connected || !me || maxT < 1 || !sel;
      big.addEventListener('click', () => {
        if (!sel) return;
        markPlaced(big, `\u2713 ${amount} 🎟 on ${sel}`);
        actions.stake(sel, amount);
      });
      host.append(big);
      if (mine) host.append(potLine(mine.amount));
      if (mine) host.append(el('div', 'stkNote', `On ${mine.ticker} · staking again moves it`));
      else if (me && maxT < 1) host.append(el('div', 'stkNote', 'You have no tickets to stake'));
      host.append(el('div', 'stkHint', 'Most-staked ticker becomes the desk’s pick'));
      return true;
    }

    // ── joining: the desk's pick is set — slide how many tickets to add ─────
    if (round.status === 'joining') {
      const t0 = (round.tally || [])[0] || { ticker: round.winningTicker || 'TBD', amount: 0 };
      const committed = t0.amount;
      const myCommitted = me ? me.committed : 0;
      host.append(el('div', 'stkTk', t0.ticker), el('div', 'stkCo', 'The desk’s pick'));
      const meta = el('div', 'stkMeta');
      const img = document.createElement('img'); img.src = tix(0); img.alt = '';
      meta.append(img, document.createTextNode(`${committed.toLocaleString()} committed`));
      if (me) meta.append(el('b', '', ` · ${me.tickets.toLocaleString()} held`));
      host.append(meta, el('div', 'stkRule'));
      host.append(el('div', 'stkQ', 'Step 2: How many tickets to add?'));

      const tickets = me ? me.tickets : 0;
      if (connected && me && tickets < 1) {
        host.append(el('div', 'stkNote', 'You have no tickets left to add.'));
      } else {
        // 1:1 desk cap estimate: my slice can be at most 5% of the final pot,
        // so cap = (committed so far − my committed) / 19.
        const capAt = Math.floor(Math.max(0, committed - myCommitted) / 19);
        let amount = seedAmount(round, Math.min(25, Math.max(1, tickets)), Math.max(1, tickets));
        const big = el('button', 'stkBig');
        const paintBig = () => { big.textContent = `Join with ${Math.min(amount, Math.max(1, tickets))} 🎟`; };
        const sl = amountInput({
          max: Math.max(1, tickets), value: amount, capAt,
          disabled: !connected || !me,
          onInput: (n) => { amount = n; remember(round, n); paintBig(); },
        });
        host.append(sl.wrap);
        paintBig();
        big.disabled = !connected || !me;
        big.addEventListener('click', () => {
          const n = Math.min(amount, Math.max(1, tickets));
          markPlaced(big, `\u2713 ${n} 🎟 added`);
          actions.join(n);
        });
        host.append(big);
      }
      // Always show what they already have committed, whether or not they can add more.
      if (me && myCommitted > 0) host.append(potLine(myCommitted));
      host.append(el('div', 'stkHint', 'Final window · profit splits by ticket share when the desk sells'));
      return true;
    }

    return false; // live/settled — nothing to do here
  }

  return { render, CSS };
})();
