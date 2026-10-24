self.EngageCore = (function () {
  const fmt = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const effectiveTarget = (reqSec, reqHb, hbInterval) => Math.max(reqSec || 120, 10 + ((reqHb || 2) - 1) * (hbInterval || 20));


  const NOT_EARNING = new Set(['platform_disabled', 'not_a_target', 'no_target', 'no_active_season',
    'no_season', 'no_reward', 'expired']);

  function rejectFor(reason) {
    const r = String(reason || '');
    if (!r) return null;
    if (r === 'comment_gate') return { key: 'commentGate', icon: 'comment' };
    if (r === 'comment_short') return { key: 'commentShort', icon: 'comment' };
    if (r === 'comment_word') return { key: 'commentWording', icon: 'comment' };
    if (r === 'comment_generic') return { key: 'commentGeneric', icon: 'comment' };
    if (r === 'comment_duplicate') return { key: 'commentCopy', icon: 'comment' };
    if (r === 'earn_gate') return { key: 'link', icon: 'link' };
    if (r === 'update_required') return { key: 'update', icon: 'wait', throttleKey: 'update', throttleMs: 60000 };
    if (r === 'not_connected' || r === 'unauthorized' || r === 'http_401') return { key: 'connect', icon: 'link', connect: true };
    if (r === 'watch_required') return { key: 'watchFirst', icon: 'eyeOpen' };
    if (NOT_EARNING.has(r)) return { key: 'notEarning', icon: 'wait', throttleKey: 'notEarning', throttleMs: 60000 };
    if (r === 'network' || r === 'bad_json' || r === 'bad_response' || /^http_(5\d\d|429|408)$/.test(r)) {
      return { key: 'network', icon: 'wait', throttleKey: 'network', throttleMs: 60000 };
    }
    return null;
  }

  function creditVerdict(kind, r) {
    if (!r || typeof r !== 'object') return { outcome: 'error', reason: 'network', tickets: null, bonusPaid: 0, bonusDone: false };
    if (r.error) return { outcome: 'error', reason: r.reason || r.error, error: String(r.error), tickets: null, bonusPaid: 0, bonusDone: false };
    const gated = r.earnGate === true || r.canEarn === false || r.reason === 'earn_gate';
    const t = r.tickets;
    const tickets = typeof t === 'number' && Number.isFinite(t) ? Math.round(t) : null;
    const bonusDone = !!(r.bonus && r.bonus.credited === true);
    const bonusPaid = !gated && bonusDone ? Math.max(0, Math.round(Number(r.bonus.awarded) || 0)) : 0;
    const base = { tickets, bonusPaid, bonusDone, reason: r.reason || null };
    if (kind === 'watch' || kind === 'replay') {
      if (r.ok === true && gated) return { ...base, outcome: 'gate', reason: 'earn_gate' };
      if (r.ok === true) {
        const n = Math.max(0, Math.round(Number(r.awarded) || 0));
        return { ...base, outcome: n > 0 ? 'paid' : 'already', amount: n };
      }
      if (r.reason === 'already_claimed' || (kind === 'replay' && r.reason === 'replay_exhausted')) return { ...base, outcome: 'already' };
      return { ...base, outcome: 'refused', reason: r.reason || 'network' };
    }
    if (r.reason === 'update_required') return { ...base, outcome: 'update' };
    if (gated) return { ...base, outcome: 'gate', reason: 'earn_gate' };
    if (kind === 'comment_like') return { ...base, outcome: r.awarded === true ? 'paid' : 'already' };
    if (r.credited === true && r.awarded === true) return { ...base, outcome: 'paid' };
    if (r.credited) return { ...base, outcome: 'already' };
    return { ...base, outcome: 'refused' };
  }

  function backoffMs(fails, baseMs, capMs) {
    const n = Math.max(1, Math.floor(Number(fails) || 1));
    return Math.min(capMs || 300000, (baseMs || 15000) * Math.pow(2, Math.min(n - 1, 16)));
  }

  function badgeTextFor(state, secondsLeft) {
    if (state === 'paused') return 'II';
    if (state !== 'counting') return '';
    const s = Math.ceil(Number(secondsLeft));
    if (!Number.isFinite(s) || s <= 0) return '';
    if (s < 60) {
      const tens = Math.ceil(s / 10) * 10;
      return tens >= 60 ? '1m' : tens + 's';
    }
    const m = Math.ceil(s / 60);
    return m <= 99 ? m + 'm' : Math.ceil(s / 3600) + 'h';
  }

  const GATED_HINT = 'Not paid. Link Kick to earn.';

  const POINTER_STEPS = ['like', 'clike', 'comment', 'repost', 'share'];
  const WATCH_GATED = { like: 1, comment: 1, clike: 1 };

  function planOrder(m) {
    const out = [];
    if (!m || m.ad) return out;
    const steps = Array.isArray(m.steps) ? m.steps : [];
    const open = (id) => steps.some((s) => s && s.id === id && !s.done && !s.voided && !s.pending);
    const w = m.watch || {};
    const watchFirst = [];
    if (w.owed) {
      if (w.muted) watchFirst.push({ id: 'watch', kind: 'mute' });
      else if (w.paused) watchFirst.push({ id: 'watch', kind: 'play' });
    }
    const seen = new Set();
    const push = (c) => { const k = c.id + ':' + c.kind; if (!seen.has(k)) { seen.add(k); out.push(c); } };
    const f = m.focus;
    if (f === 'watch' || f === 'replay') watchFirst.forEach(push);
    else if (f && POINTER_STEPS.indexOf(f) >= 0 && open(f) && !(m.gate && WATCH_GATED[f])) push({ id: f, kind: 'tix' });
    watchFirst.forEach(push);
    for (const id of POINTER_STEPS) {
      if (!open(id)) continue;
      if (m.gate && WATCH_GATED[id]) continue;
      push({ id, kind: 'tix' });
    }
    return out;
  }

  function stepList(state, rewards, c) {
    const out = [];
    if (!state || !rewards || !c) return out;
    const gatedDone = (row, action) => {
      if (!row.done || !(state.gated && state.gated[action])) return row;
      return Object.assign(row, { amount: '', collected: 0, hint: GATED_HINT });
    };
    if (c.watch) {
      const done = !!state.watchDone;
      let hint = null;
      if (!done && c.watchErr) hint = c.watchErr;
      else if (!done && c.early > 0) hint = `Includes a +${c.early} early bonus while the video is new`;
      out.push({ id: 'watch', icon: 'eyeOpen',
        label: done ? 'Watched' : `Watch with sound on (${fmt(c.watchLeft || 0)} left)`,
        amount: done && state.awarded != null ? state.awarded : c.watchAmount,
        done, pending: !done && !!state.claiming,
        collected: done && state.awarded != null ? state.awarded : null, hint });
    }
    if (c.replay) {
      const rw = state.replayReward || 1;
      const rdone = !!state.replayAllDone;
      out.push({ id: 'replay', icon: 'eyeOpen',
        label: rdone ? 'Watched again' : (state.replaying ? `Watch it again (${fmt(c.replayLeft || 0)} left)` : 'Watch it again'),
        amount: rw, done: rdone, pending: !!(state.replaying && state.claiming),
        collected: rdone ? rw * (state.replayUsed || 1) : null,
        hint: !rdone && c.replayErr ? c.replayErr : null });
    }
    if (c.like) {
      out.push(gatedDone({ id: 'like', icon: 'like', label: c.likeLabel || 'Like it', amount: rewards.likeReward,
        done: state.likeS === 'done', pending: state.likeS === 'pending' }, 'like'));
    }
    if (c.comment) {
      out.push(state.commentS === 'voided'
        ? { id: 'comment', icon: 'comment', label: 'Comment deleted, ticket returned', amount: '', done: false, voided: true }
        : gatedDone({ id: 'comment', icon: 'comment', label: 'Comment something meaningful', amount: rewards.commentReward,
          done: state.commentS === 'done', pending: state.commentS === 'pending' }, 'comment'));
    }
    if (c.repost) {
      out.push(gatedDone({ id: 'repost', icon: 'repost', label: 'Repost it', amount: rewards.repostReward,
        done: state.repostS === 'done', pending: state.repostS === 'pending' }, 'repost'));
    }
    if (c.share) {
      out.push(gatedDone({ id: 'share', icon: 'share', label: 'Share it', amount: rewards.shareSendReward,
        done: state.sendS === 'done', pending: state.sendS === 'pending',
        hint: state.sendS !== 'done' && c.shareMissing ? 'No share button? Refresh the page' : null }, 'share_send'));
    }
    if (c.clike) {
      const clMax = c.clMax || 0;
      const clDone = Math.min(state.clDone || 0, clMax);
      const allDone = clDone >= clMax;
      const clGated = Math.min(clDone, state.clGated || 0);
      const clPaid = clDone - clGated;
      out.push({ id: 'clike', icon: 'clike', label: clMax > 1 ? `Like ${clMax} comments` : 'Like a comment',
        amount: allDone ? (clPaid > 0 ? clPaid * rewards.commentLikeReward : '') : `+${rewards.commentLikeReward} each`,
        done: allDone,
        collected: clGated ? clPaid * rewards.commentLikeReward : ((state.clDone || 0) * rewards.commentLikeReward),
        hint: clDone > 0 && !allDone ? `${clPaid} of ${clMax} collected` : (allDone && clGated ? GATED_HINT : null) });
    }
    if (c.bonus) {
      out.push(gatedDone({ id: 'bonus', icon: 'ticket', label: 'Do it all', amount: rewards.engageBonusReward, done: !!state.bonusDone }, 'bonus'));
    }
    return out;
  }

  function init(A) {
    let state = null, commentHooked = false, likeHooked = false, lastHb = 0;
    let commentLikeHooked = false;
    let commentDeleteHooked = false;
    let rewards = { likeReward: 0, commentReward: 0, watchVideoReward: 0, watchFloor: 5, watchPerMinute: 1,
      repostReward: 0, shareSendReward: 0, engageBonusReward: 0, commentLikeReward: 0, commentLikeMax: 0 };

    let dead = false, tickIv = null, urlIv = null;
    const invalidated = (err) => /context invalidated/i.test(String((err && err.message) || err || ''));
    function die() {
      if (dead) return;
      dead = true;
      try { clearHud(); } catch {   }
      if (tickIv) clearInterval(tickIv);
      if (urlIv) clearInterval(urlIv);
    }
    function send(msg) {
      if (dead) return Promise.resolve(null);
      try {
        if (!chrome.runtime || !chrome.runtime.id) { die(); return Promise.resolve(null); }
        return Promise.resolve(chrome.runtime.sendMessage(msg)).catch((err) => { if (invalidated(err)) die(); return null; });
      } catch (err) {
        if (invalidated(err)) die();
        return Promise.resolve(null);
      }
    }
    function ownUi(e) {
      try {
        const g = self.RGCGuide;
        if (g && typeof g.ownsEvent === 'function' && g.ownsEvent(e)) return true;
        const path = e && typeof e.composedPath === 'function' ? e.composedPath() : [];
        for (const n of path) {
          const id = n && n.id;
          if (typeof id === 'string' && id.slice(0, 4) === 'rgc-') return true;
        }
      } catch {   }
      return false;
    }
    try {
      document.querySelectorAll('[id^="rgc-ring-"],[id^="rgc-grid-"],[id^="rgc-frame-"]')
        .forEach((n) => { try { n.remove(); } catch {   } });
    } catch {   }

    let shareHidden = false;
    let bal = { tickets: null, canEarn: null };
    let extUpdate = null;
    try {
      chrome.storage.local.get(['shareHidden', 's2Balance', 'extUpdate']).then((s) => {
        if (dead || !s) return;
        shareHidden = s.shareHidden === true;
        takeBalance(s.s2Balance);
        extUpdate = s.extUpdate || null;
        applyVersion();
        drawHud();
      }).catch((err) => { if (invalidated(err)) die(); });
    } catch (err) { if (invalidated(err)) die(); }
    try {
      chrome.storage.onChanged.addListener((ch, area) => {
        if (dead || !ch || (area && area !== 'local')) return;
        if (ch.shareHidden) { shareHidden = ch.shareHidden.newValue === true; drawHud(); }
        if (ch.s2Balance) takeBalance(ch.s2Balance.newValue);
        if (ch.extUpdate) { extUpdate = ch.extUpdate.newValue || null; applyVersion(); }
        if (ch.s2Token) {
          connectGate = false;
          const ref = A.getRef();
          clearHud();
          if (ref) start(ref);
        }
      });
    } catch (err) { if (invalidated(err)) die(); }

    const doneKey = (ref) => `rgcDone:${A.platform}:${ref}`;
    async function getDone(ref) { try { const k = doneKey(ref); return (await chrome.storage.local.get(k))[k] || {}; } catch (err) { if (invalidated(err)) die(); return {}; } }
    async function setDone(ref, patch) { try { const k = doneKey(ref); const cur = (await chrome.storage.local.get(k))[k] || {}; await chrome.storage.local.set({ [k]: { ...cur, ...patch } }); } catch (err) { if (invalidated(err)) die(); } }

    function adPlaying(v) { try { return typeof A.isAdPlaying === 'function' && !!A.isAdPlaying(v); } catch { return false; } }
    function durationMin(v) {
      if (!v || (state && state.adNow)) return 0;
      return (isFinite(v.duration) && v.duration > 0) ? Math.floor(v.duration / 60) : 0;
    }
    function watchPotential() {
      const srv = Number(state && state.targetReward);
      if (Number.isFinite(srv) && srv > 0) return srv;
      return Math.max(rewards.watchFloor || 5, durationMin(state && state.vid) * (rewards.watchPerMinute || 1));
    }
    function earlyBonusNow() {
      const bonus = Number(rewards.watchEarlyBonus) || 0;
      if (bonus <= 0) return 0;
      const srv = Number(state && state.targetReward);
      if (!Number.isFinite(srv) || srv <= 0) return 0;
      const base = Math.max(rewards.watchFloor || 5, durationMin(state && state.vid) * (rewards.watchPerMinute || 1));
      return srv - base === bonus ? bonus : 0;
    }
    function replayAvailable() {
      return !!(state && state.replayEligible && (state.replayMax || 0) > 0);
    }
    const repostCapable = () => !!(state && state.canRepost) && !shareHidden
      && typeof A.repostTarget === 'function';
    const sendCapable = () => !!(state && state.canSend) && typeof A.sendTarget === 'function';
    const focalReposted = () => {
      try {
        if (typeof A.isRepostedFocal !== 'function') return adapterReposted();
        return A.isRepostedFocal() === true;
      } catch { return false; }
    };
    const adapterReposted = () => { try { return typeof A.isReposted === 'function' && !!A.isReposted(); } catch { return false; } };
    const focalLiked = () => {
      try {
        if (typeof A.isLikedFocal !== 'function') return !!A.isLiked();
        return A.isLikedFocal() === true;
      } catch { return false; }
    };
    function bonusReachable() {
      if (!state) return false;
      if (state.canRepost && !repostCapable()) return false;
      if (state.canSend && !sendCapable()) return false;
      return true;
    }
    function earnBlocked() {
      if (typeof A.earnBlocked !== 'function') return null;
      try { return A.earnBlocked() || null; } catch { return null; }
    }
    let blockedAt = 0, blockedVal = null;
    function earnBlockedForDraw() {
      const now = Date.now();
      if (now - blockedAt >= 4000) { blockedAt = now; blockedVal = earnBlocked(); }
      return blockedVal;
    }
    function watchErrText(reason) {
      if (reason === 'not_qualified') return 'No watch time counted yet. Keep this tab visible with the video playing and unmuted.';
      if (reason === 'no_reward') return 'This video is too old to earn tickets.';
      if (reason === 'no_target' || reason === 'platform_disabled') return 'This video is not collectable right now.';
      return 'Could not collect. Check your connection, then reload the page.';
    }

    let hud = null;
    let canEarn = null;
    let connectGate = false;
    let updateRequired = false;
    let linkTipShown = false;
    let creditsInFlight = 0, balPending = false;
    let focus = null;
    let ptrHoldUntil = 0;
    const ptrEl = Object.create(null);
    const ctl = Object.create(null);
    const videoTipShown = { mute: false, play: false };
    const G = () => self.RGCGuide || null;
    const copy = (key) => { const g = G(); return (g && g.COPY && g.COPY[key]) || ''; };
    function hudCall(fn) { if (!hud) return undefined; try { return fn(hud); } catch { return undefined; } }
    function ensureHud() {
      if (hud || dead || !state) return hud;
      const g = G();
      if (!g || typeof g.create !== 'function') return null;
      try { hud = g.create({ platform: A.platform, kick: false }); } catch { hud = null; }
      if (!hud) return null;
      pillKey = ''; badgeLast = null; watchKey = '';
      applyVersion();
      hudCall((h) => { if (typeof h.setReport === 'function') h.setReport(() => openReport('panel')); });
      if (typeof bal.tickets === 'number') hudCall((h) => h.setTotal(bal.tickets, { animate: false }));
      if (canEarn === false || connectGate) hudCall((h) => h.setCanEarn(false, connectGate ? { chip: copy('connectChip') } : undefined));
      return hud;
    }
    const diagEvents = [];
    function noteDiag(ev, reason) {
      try {
        diagEvents.push({ at: Date.now(), ev: String(ev).slice(0, 24), reason: reason ? String(reason).slice(0, 40) : undefined });
        if (diagEvents.length > 20) diagEvents.splice(0, diagEvents.length - 20);
      } catch {   }
    }
    function diagSnapshot() {
      const out = { platform: A.platform, path: '', ref: null, bound: !!state, events: diagEvents.slice() };
      try { out.path = String(location.pathname || '').slice(0, 200); } catch {   }
      try { out.ref = (state && state.ref) || A.getRef() || null; } catch { out.ref = state ? state.ref : null; }
      out.canEarn = canEarn; out.connectGate = connectGate; out.updateRequired = updateRequired;
      if (state) {
        try {
          out.steps = buildSteps().map((x) => ({ id: x.id, done: !!x.done, pending: !!x.pending, voided: !!x.voided, count: x.count === false ? false : undefined }));
        } catch { out.steps = []; }
        out.watch = {
          done: !!state.watchDone, playing: !!state.watchPlaying, muted: !!state.watchMuted,
          watched: state.watched || 0, target: state.target || 0, session: !!state.sessionId,
          gated: !!state.watchGated, replaying: !!state.replaying, ad: !!state.adNow, hasVideo: !!state.hasVideo,
        };
        out.states = { like: state.likeS, comment: state.commentS, repost: state.repostS, send: state.sendS, clDone: state.clDone };
      }
      try { const h = hud && typeof hud.state === 'function' ? hud.state() : null; if (h && h.pointer) out.pointer = { kind: h.pointer.kind || null, visible: !!h.pointer.visible, open: !!h.open }; } catch {   }
      return out;
    }
    function openReport(from, reason) {
      send({ type: 'bugStart', from, reason: reason || null, page: diagSnapshot() });
    }
    try {
      if (window.top === window) {
        chrome.runtime.onMessage.addListener((msg, _s, reply) => {
          if (!msg || msg.type !== 'rgcDiag') return undefined;
          try { reply(diagSnapshot()); } catch { reply(null); }
          return undefined;
        });
      }
    } catch {   }
    let lastRejectReason = null;

    function clearHud() {
      try { cancelClickOnlyShare(); } catch {   }
      try { stopRepostToast(); } catch {   }
      if (state && A.actions.watch) sendBadge(null);
      if (dockIo) { try { dockIo.disconnect(); } catch {   } dockIo = null; }
      dockTarget = null; dockAnchor = null; dockVisible = false;
      if (hud) { try { hud.destroy(); } catch {   } hud = null; }
      pillKey = ''; watchKey = ''; focus = null;
      state = null;
    }
    let dockIo = null, dockTarget = null, dockAnchor = null, dockVisible = false;
    function applyDock() {
      if (!hud || typeof hud.dock !== 'function') return;
      if (dockTarget && dockVisible && dockTarget.isConnected !== false) hudCall((h) => h.dock(dockTarget, (dockAnchor && dockAnchor.o) || undefined));
      else hudCall((h) => h.dock(null));
    }
    function syncHudDock() {
      if (!hud || typeof A.hudAnchor !== 'function') return;
      let a = null;
      if (state && state.vid && state.hasVideo) { try { a = A.hudAnchor(state.vid); } catch { a = null; } }
      const el = a && a.el && a.el.nodeType === 1 ? a.el : null;
      if (el !== dockTarget) {
        if (dockIo) { try { dockIo.disconnect(); } catch {   } dockIo = null; }
        dockTarget = el; dockAnchor = a; dockVisible = false;
        if (el && typeof IntersectionObserver === 'function') {
          try {
            dockIo = new IntersectionObserver((es) => {
              const e = es[es.length - 1];
              dockVisible = !!(e && e.isIntersecting && e.intersectionRatio >= 0.5);
              applyDock();
            }, { threshold: [0, 0.5, 1] });
            dockIo.observe(el);
          } catch { dockIo = null; }
        }
      } else if (a) dockAnchor = a;
      applyDock();
    }
    function applyVersion() {
      if (!hud) return;
      let ver = '';
      try { ver = chrome.runtime.getManifest().version || ''; } catch { ver = ''; }
      const u = extUpdate || {};
      hudCall((h) => h.setVersion({ ver, update: { available: !!u.available, latest: u.latest || '', required: updateRequired } },
        () => send({ type: 'applyUpdate' })));
    }
    function takeBalance(rec) {
      const t = rec && typeof rec.tickets === 'number' && Number.isFinite(rec.tickets) ? Math.round(rec.tickets) : null;
      bal = { tickets: t, canEarn: rec && typeof rec.canEarn === 'boolean' ? rec.canEarn : null };
      if (t != null && hud) {
        if (creditsInFlight > 0) balPending = true;
        else hudCall((h) => h.setTotal(t, { animate: false }));
      }
      if (bal.canEarn != null) applyCanEarn(bal.canEarn);
    }
    function flushBalance() {
      if (creditsInFlight > 0 || !balPending) return;
      balPending = false;
      if (typeof bal.tickets === 'number') hudCall((h) => h.setTotal(bal.tickets, { animate: false }));
    }
    function applyCanEarn(v) {
      if (typeof v !== 'boolean') return;
      const was = canEarn;
      canEarn = v;
      if (v) connectGate = false;
      if (!hud) return;
      hudCall((h) => h.setCanEarn(v, !v && connectGate ? { chip: copy('connectChip') } : undefined));
      if (v === false && !linkTipShown && !connectGate) {
        linkTipShown = true;
        hudCall((h) => h.tip({ el: 'hud', text: copy('link'), icon: 'link' }));
      }
      if (v === true && was === false && state && state.watchGated) {
        state.watchGated = false;
        state.sessionId = null;
        state.claimRetryAt = 0;
        startWatch();
      }
      if (was !== v) drawHud();
    }
    function usable(el) {
      try {
        if (!el || el.nodeType !== 1 || el.isConnected === false) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
          && r.top < (window.innerHeight || 0) && r.left < (window.innerWidth || 0);
      } catch { return false; }
    }
    function noteCtl(action, el) { if (el && el.nodeType === 1) ctl[action] = { el, at: Date.now() }; }
    const STEP_OF = { like: 'like', comment: 'comment', repost: 'repost', share_send: 'share', comment_like: 'clike' };
    const RESOLVER = { like: 'likePointerTarget', comment: 'commentPointerTarget', repost: 'repostPointerTarget',
      share: 'sendPointerTarget', clike: 'commentLikePointerTarget' };
    function resolverEl(stepId) {
      const fn = RESOLVER[stepId];
      if (!fn || typeof A[fn] !== 'function') return null;
      try { const el = A[fn](); return el && el.nodeType === 1 ? el : null; } catch { return null; }
    }
    function originFor(action) {
      const c = ctl[action];
      const step = STEP_OF[action];
      const cands = [c && Date.now() - c.at < 120000 ? c.el : null, ptrEl[step]];
      for (const el of cands) if (usable(el)) return el;
      const r = resolverEl(step);
      return usable(r) ? r : 'hud';
    }
    function eyeOrHud() { return state && state.vid && state.hasVideo ? 'eye' : 'hud'; }
    function celebrate(o) {
      const nt = typeof o.tickets === 'number' ? o.tickets : undefined;
      if (nt != null) { bal.tickets = nt; balPending = false; }
      if (!hud) return;
      const n = Math.max(0, Math.round(Number(o.amount) || 0));
      if (n > 0 && !o.quiet) {
        ptrHoldUntil = Date.now() + 1300;
        hudCall((h) => h.pointTo(null));
        hudCall((h) => h.cashIn({ fromEl: o.from || 'hud', amount: n, newTotal: nt }));
      } else if (nt != null) hudCall((h) => h.setTotal(nt, { animate: false }));
    }
    function showReject(reason, el, fallback) {
      const m = rejectFor(reason) || (fallback ? rejectFor(fallback) : null);
      noteDiag('reject', reason || fallback || '');
      if (!m || !hud) return;
      lastRejectReason = String(reason || fallback || '');
      if (m.connect) {
        connectGate = true;
        canEarn = false;
        hudCall((h) => h.setCanEarn(false, { chip: copy('connectChip') }));
      }
      const at = el === 'hud' || el === 'eye' || usable(el) ? el : 'hud';
      const why = lastRejectReason;
      hudCall((h) => h.reject({ el: at, text: copy(m.key), icon: m.icon, throttleKey: m.throttleKey, throttleMs: m.throttleMs,
        onReport: () => openReport('reject', why) }));
    }
    function gateReject(el, tickets) {
      showReject('earn_gate', el);
      if (typeof tickets === 'number') hudCall((h) => h.setTotal(tickets, { animate: false }));
      applyCanEarn(false);
    }
    function needUpdate(el) {
      if (!updateRequired) { updateRequired = true; applyVersion(); }
      showReject('update_required', el);
    }
    function rejectComment(reason) { showReject(reason || 'comment_gate', originFor('comment'), 'comment_gate'); }

    let badgeLast = null;
    function sendBadge(st, secondsLeft) {
      try { if (window.top !== window) return; } catch { return; }
      const text = st === 'counting' ? badgeTextFor('counting', secondsLeft) : (st && st !== 'done' ? 'II' : '');
      if (text === badgeLast) return;
      if (badgeLast === null && !text) { badgeLast = ''; return; }
      badgeLast = text;
      send(text
        ? { type: 's2Badge', state: st === 'counting' ? 'counting' : 'paused', secondsLeft: Math.max(0, Math.ceil(secondsLeft || 0)) }
        : { type: 's2Badge', state: 'clear' });
    }

    function realVideo(v) {
      if (!v) return false;
      if ((A.platform === 'instagram' || A.platform === 'facebook') && typeof A.playerHost === 'function') {
        try { return !!A.playerHost(v); } catch { return false; }
      }
      return true;
    }
    function pickVideo() {
      if (!state) return null;
      let v = null;
      try { v = A.getVideoEl(); } catch { v = null; }
      state.vid = v;
      state.hasVideo = realVideo(v);
      state.pillHost = null;
      if (v && !A.watchPillFixed && typeof A.playerHost === 'function') {
        try { state.pillHost = A.playerHost(v) || null; } catch { state.pillHost = null; }
      }
      state.adNow = adPlaying(v);
      return v;
    }
    function watchOwed() {
      if (!state || !A.actions.watch || !state.vid || !state.hasVideo) return false;
      if (state.watchGated || state.claimStopped) return false;
      if (state.replaying) return !state.replayStopped;
      return !state.watchDone && !!(state.sessionId || state.watchStarting);
    }
    function watchGateOn() {
      return !!(state && state.watchGate && A.actions.watch && state.hasVideo && !state.watchDone && !state.claimStopped);
    }
    const PHOTO_PLATFORM = A.platform === 'instagram' || A.platform === 'facebook';
    function notStarted(v) {
      if (!v || v.currentTime > 0) return false;
      try { return !(v.played && v.played.length > 0); } catch { return true; }
    }
    function pillSpec() {
      if (!state || !A.actions.watch) return null;
      const v = state.vid;
      if (!v || !state.hasVideo) return null;
      if (state.watchDone && !state.replaying) return state.pillDone ? { state: 'done', secondsLeft: 0, amount: state.pillDoneAmt || 0 } : null;
      if (state.claimStopped) return null;
      if (!state.sessionId) return null;
      const left = Math.max(0, (state.target || 0) - (state.watched || 0));
      const amount = state.replaying ? (state.replayReward || 1) : watchPotential();
      let st;
      if (canEarn === false || state.watchGated) st = 'gate';
      else if (state.adNow) st = 'ad';
      else if (document.visibilityState !== 'visible') st = 'hidden';
      else if (v.ended) st = state.replaying ? 'starting' : 'paused';
      else if (v.paused || notStarted(v)) st = 'paused';
      else if (v.muted || !(v.volume > 0)) st = 'muted';
      else st = 'counting';
      return { state: st, secondsLeft: left, amount };
    }
    let pillKey = '', watchKey = '';
    function updateWatchUi(force, replan) {
      if (!hud || !state) return false;
      const p = pillSpec();
      const key = p ? [p.state, p.secondsLeft, p.amount, state.pillHost ? 'h' : 'f'].join('|') : '';
      const changed = key !== pillKey;
      if (!changed && !force) return false;
      pillKey = key;
      if (!p) {
        hudCall((h) => h.watchPill(null));
        sendBadge(null);
      } else {
        const muted = p.state === 'muted';
        hudCall((h) => h.watchPill({
          videoEl: state.vid, host: state.pillHost || undefined, state: p.state,
          secondsLeft: p.secondsLeft, amount: p.amount,
          tappable: false,
          tipText: muted && PHOTO_PLATFORM ? copy('tapForSound') : undefined,
        }));
        sendBadge(p.state, p.secondsLeft);
      }
      const v = state.vid;
      const wk = [watchOwed(), !!(v && (v.muted || !(v.volume > 0))), !!(v && (v.paused || v.ended)), !!state.adNow].join();
      if (wk !== watchKey) { watchKey = wk; if (replan) planPointer(false); }
      return changed;
    }

    function stepCaps() {
      const watchOn = !!(A.actions.watch && (state.sessionId || state.watchDone));
      return {
        watch: watchOn,
        watchLeft: Math.max(0, (state.target || 0) - (state.watched || 0)),
        watchAmount: watchPotential(),
        watchErr: state.watchError && !state.watchDone ? watchErrText(state.watchError) : null,
        early: state.watchDone ? 0 : earlyBonusNow(),
        replay: watchOn && !!state.watchDone && replayAvailable(),
        replayLeft: Math.max(0, (state.target || 0) - (state.watched || 0)),
        replayErr: state.replayStopped ? watchErrText(state.replayError) : null,
        like: !!(A.actions.like && rewards.likeReward > 0),
        likeLabel: A.platform === 'reddit' ? 'Upvote it' : (A.actions.watch && state.hasVideo ? 'Like the video' : 'Like the post'),
        comment: !!(A.actions.comment && state.commentEnabled !== false && (rewards.commentReward > 0 || state.commentS === 'voided')),
        repost: repostCapable() && rewards.repostReward > 0,
        share: sendCapable() && rewards.shareSendReward > 0,
        shareMissing: sendMissing(),
        clike: commentLikeCapable() && rewards.commentLikeReward > 0 && commentLikeMax() > 0,
        clMax: commentLikeMax(),
        bonus: rewards.engageBonusReward > 0 && (state.bonusDone || bonusReachable()),
      };
    }
    function sendMissing() {
      if (!state || state.sendS === 'done' || typeof A.sendPresent !== 'function') return false;
      try { return !A.sendPresent(); } catch { return false; }
    }
    function buildSteps() {
      return stepList(state, rewards, stepCaps()).map((s) => Object.assign(s, { onTap: onStepTap }));
    }
    const coarse = () => { try { return !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches); } catch { return false; } };
    function stepTip(id) {
      if (id === 'like') return A.platform === 'reddit' ? 'Tap the up arrow to upvote it.' : 'Tap Like.';
      if (id === 'comment') return 'Write a real comment about it, then post it.';
      if (id === 'repost') return A.platform === 'tiktok' ? 'Tap Share, then Repost.' : 'Tap Repost.';
      if (id === 'share') return 'Tap Share and share it anywhere.';
      if (id === 'clike') return 'Like a comment under the post.';
      if (id === 'bonus') return 'Finish every step above to earn this too.';
      return '';
    }
    function videoTip(kind) {
      const touch = coarse();
      if (kind === 'mute') return touch ? copy('tapVideoThenSpeaker') : 'Move the mouse over the video, then click the speaker.';
      return touch ? 'Tap the video, then the play button.' : 'Move the mouse over the video, then click play.';
    }
    const STEP_ICON = { like: 'like', comment: 'comment', repost: 'repost', share: 'share', clike: 'clike', bonus: 'ticket', watch: 'eyeOpen', replay: 'eyeOpen' };
    let replanT = null;
    function scheduleReplan(ms) {
      if (replanT) return;
      replanT = setTimeout(() => { replanT = null; if (!dead) planPointer(false); }, Math.max(0, Number(ms) || 0));
    }
    function planPointer(focusTap, steps) {
      if (!hud || !state || dead) return null;
      if (state.ref !== A.getRef()) { hudCall((h) => h.pointTo(null)); return null; }
      if (document.visibilityState !== 'visible') return null;
      const hold = ptrHoldUntil - Date.now();
      if (hold > 0 && !focusTap) { scheduleReplan(hold + 20); return null; }
      try {
        const v = state.vid;
        const order = planOrder({
          steps: steps || (earnBlockedForDraw() ? [] : buildSteps()), focus, gate: watchGateOn(), ad: !!state.adNow,
          watch: { owed: watchOwed(), muted: !!(v && (v.muted || !(v.volume > 0))), paused: !!(v && (v.paused || v.ended)) },
        });
        for (const c of order) {
          let el = null;
          if (c.kind === 'mute' || c.kind === 'play') {
            const fn = c.kind === 'mute' ? 'muteControl' : 'playControl';
            try { el = typeof A[fn] === 'function' ? A[fn](v) : null; } catch { el = null; }
            if (!el && c.kind === 'mute' && PHOTO_PLATFORM && !state.soundTipShown) {
              state.soundTipShown = true;
              hudCall((h) => h.tip({ el: 'eye', text: copy('tapForSound'), icon: 'mute' }));
            }
          } else el = resolverEl(c.id);
          if (!el || el.nodeType !== 1) continue;
          const isVideo = String(el.tagName || '').toUpperCase() === 'VIDEO';
          const amount = c.kind === 'tix'
            ? (c.id === 'clike' ? rewards.commentLikeReward : ({ like: rewards.likeReward, comment: rewards.commentReward,
              repost: rewards.repostReward, share: rewards.shareSendReward })[c.id] || 0)
            : watchPotential();
          const spec = { el, kind: c.kind, amount, onLost: () => scheduleReplan(0), onTap: () => scheduleReplan(1300) };
          if (!isVideo && (c.kind === 'mute' || c.kind === 'play')) spec.allowFaded = true;
          if (isVideo && typeof A.playerHost === 'function') {
            try { const sc = A.playerHost(v); if (sc && sc.nodeType === 1) spec.hitScope = sc; } catch {   }
          }
          let tipText = '';
          if (isVideo && !videoTipShown[c.kind]) tipText = videoTip(c.kind);
          else if (focusTap && c.id === focus) tipText = c.id === 'watch' ? watchTip() : stepTip(c.id);
          if (tipText) spec.tip = { text: tipText, icon: c.kind === 'tix' ? STEP_ICON[c.id] : (c.kind === 'mute' ? 'mute' : 'eyeOpen') };
          let ok = false;
          try { ok = hud.pointTo(spec) !== false; } catch { ok = false; }
          if (ok) {
            if (isVideo) videoTipShown[c.kind] = true;
            ptrEl[c.id] = el;
            ptrIdle = false;
            return c;
          }
        }
        ptrIdle = true;
        hudCall((h) => h.pointTo(null));
      } catch { ptrIdle = true; hudCall((h) => h.pointTo(null)); }
      return null;
    }
    let ptrIdle = false, scrollReplanT = null;
    window.addEventListener('scroll', () => {
      if (!ptrIdle || dead || !state || !hud) return;
      if (scrollReplanT) clearTimeout(scrollReplanT);
      scrollReplanT = setTimeout(() => { scrollReplanT = null; if (ptrIdle && !dead && state) planPointer(false); }, 450);
    }, { passive: true, capture: true });
    function watchTip() {
      const g = G();
      if (!g || typeof g.watchTipText !== 'function') return '';
      const p = pillSpec();
      return g.watchTipText(p ? p.amount : watchPotential(), p ? p.secondsLeft : null);
    }
    function onStepTap(step) {
      if (!state || !hud || !step) return;
      const id = step.id;
      if (id === 'watch' || id === 'replay') {
        focus = 'watch';
        const c = planPointer(true);
        if (c && c.id === 'watch') return;
        const p = pillSpec();
        const text = p && p.state === 'muted' && PHOTO_PLATFORM ? copy('tapForSound') : watchTip();
        if (text) hudCall((h) => h.tip({ el: p ? 'eye' : 'hud', text, icon: 'eyeOpen' }));
        return;
      }
      if (step.voided) { hudCall((h) => h.tip({ el: 'hud', text: 'Comment deleted, ticket returned.', icon: 'comment' })); return; }
      if (watchGateOn() && WATCH_GATED[id]) { hudCall((h) => h.tip({ el: 'hud', text: copy('watchFirst'), icon: 'eyeOpen' })); return; }
      focus = id;
      const c = planPointer(true);
      if (!c || c.id !== id) {
        const text = stepTip(id);
        if (text) hudCall((h) => h.tip({ el: 'hud', text, icon: STEP_ICON[id] || 'ticket' }));
      }
    }
    function drawHud(tick) {
      if (!state || dead) return;
      if (state.ref !== A.getRef()) return;
      if (!ensureHud()) return;
      const blocked = earnBlockedForDraw();
      let notice = null;
      if (!blocked && typeof A.notice === 'function') { try { notice = A.notice() || null; } catch { notice = null; } }
      const steps = blocked ? [] : buildSteps();
      if (focus && !steps.some((s) => s.id === focus && !s.done)) focus = null;
      hudCall((h) => { h.setBlocked(blocked); h.setNotice(notice); h.setSteps(steps); });
      syncHudDock();
      updateWatchUi(!!tick, false);
      if (document.visibilityState === 'visible') planPointer(false, steps);
    }

    const ACTION_KEY = { like: 'likeS', comment: 'commentS', repost: 'repostS', share_send: 'sendS' };
    const ACTION_FLAG = { like: 'like', comment: 'comment', repost: 'repost', share_send: 'send' };
    const ACTION_REWARD = { like: 'likeReward', comment: 'commentReward', repost: 'repostReward', share_send: 'shareSendReward' };
    const LONG_BACKOFF_MS = 600000;
    async function fireEngagement(action, extra) {
      const ref = state && state.ref; if (!ref) return;
      const key = ACTION_KEY[action]; if (!key) return;
      if (state[key] !== 'idle') return;
      ptrHoldUntil = Math.max(ptrHoldUntil, Date.now() + 1300);
      hudCall((h) => h.pointTo(null));
      state[key] = 'pending'; drawHud();
      const msg = { type: 's2Engagement', platform: A.platform, action, ref };
      if (extra && typeof extra.commentId === 'string' && extra.commentId) msg.commentId = extra.commentId;
      if (action === 'comment' && extra && typeof extra.text === 'string' && extra.text.trim()) msg.text = extra.text.trim().slice(0, 2000);
      creditsInFlight++;
      let r = null;
      try { r = await send(msg); } finally { creditsInFlight = Math.max(0, creditsInFlight - 1); }
      const failed = !r || !!r.error;
      const vd = creditVerdict('engagement', r);
      if (!state || state.ref !== ref) {
        if (!failed && r.credited) setDone(ref, { [ACTION_FLAG[action]]: true });
        if (!failed && r.bonus && r.bonus.credited) setDone(ref, { bonus: true });
        flushBalance();
        return;
      }
      if (!failed && r.credited) { state[key] = 'done'; setDone(ref, { [ACTION_FLAG[action]]: true }); }
      else if (!failed && action === 'comment' && r.reason === 'comment_rejected') {
        state[key] = 'idle';
        rejectComment(r.why === 'comment_generic' || r.why === 'comment_duplicate' ? r.why : 'comment_gate');
        flushBalance(); drawHud(); return;
      }
      else if (!failed && r.reason === 'update_required') {
        state[key] = 'idle';
        state.retryAt[action] = Date.now() + LONG_BACKOFF_MS;
        needUpdate(originFor(action));
        flushBalance(); drawHud(); return;
      }
      else if (!failed && (action === 'like' || action === 'repost')) { state[key] = 'done'; setDone(ref, { [ACTION_FLAG[action]]: true }); }
      else state[key] = 'idle';
      if (r && r.bonus && r.bonus.credited) { state.bonusDone = true; setDone(ref, { bonus: true }); }
      if (failed) engagementFailed(action, vd.reason, msg.commentId, vd.error);
      else {
        state.fails[action] = 0;
        const from = originFor(action);
        if (vd.outcome === 'paid') {
          celebrate({ from, amount: (Number(rewards[ACTION_REWARD[action]]) || 0) + vd.bonusPaid, tickets: vd.tickets,
            quiet: !!(extra && extra.quiet) });
        } else if (vd.outcome === 'gate') {
          state.gated[action] = true;
          if (vd.bonusDone) state.gated.bonus = true;
          gateReject(from, vd.tickets);
        } else celebrate({ from, amount: vd.bonusPaid, tickets: vd.tickets });
      }
      flushBalance();
      drawHud();
    }
    function engagementFailed(action, reason, commentId, fallback) {
      if (!state) return;
      const n = (state.fails[action] || 0) + 1;
      state.fails[action] = n;
      if (reason === 'watch_required') {
        if (action === 'like') state.held.like = true;
        if (action === 'comment') state.held.comment = { commentId: commentId || null };
      }
      state.retryAt[action] = Date.now() + (NOT_EARNING.has(reason) ? LONG_BACKOFF_MS : backoffMs(n, 15000, 300000));
      showReject(reason, originFor(action), fallback);
    }
    function releaseHeld() {
      if (!state || !state.held) return;
      state.clRetryAt = 0;
      if (state.held.like) {
        state.held.like = false;
        state.retryAt.like = 0;
        if (state.likeS === 'idle' && (focalLiked() || state.serverLiked)) fireEngagement('like');
      }
      applyKnownLiked();
      if (state.held.comment) {
        const h = state.held.comment;
        state.held.comment = null;
        if (state.commentS === 'idle') fireEngagement('comment', h.commentId ? { commentId: h.commentId } : undefined);
      }
    }

    const CL_CONFIRM_MS = 90000;
    let pendingCommentLikeUntil = 0, pendingCommentLikeRef = '';
    function commentLikeMax() { return Number(rewards.commentLikeMax) || 0; }
    function commentLikeCapable() {
      if (!state || state.canCommentLike !== true) return false;
      if (A.commentLikeConfirmNetwork) return typeof A.commentLikeTarget === 'function';
      return typeof A.commentLikeScan === 'function';
    }
    function commentLikeOpen() {
      if (!commentLikeCapable()) return false;
      if (!(rewards.commentLikeReward > 0)) return false;
      if (state.clCapped) return false;
      return (state.clDone || 0) < commentLikeMax();
    }
    async function fireCommentLike(commentId) {
      if (!commentLikeOpen()) return;
      if (typeof commentId !== 'string' || !/^[\w.-]{1,120}$/.test(commentId)) return;
      if (state.clSent[commentId]) return;
      const ref = state.ref;
      const st = state;
      state.clSent[commentId] = true;
      creditsInFlight++;
      st.clPending = (st.clPending || 0) + 1;
      let r = null;
      try {
        r = await send({ type: 's2Engagement', platform: A.platform, action: 'comment_like', ref, commentId });
      } finally { creditsInFlight = Math.max(0, creditsInFlight - 1); st.clPending = Math.max(0, (st.clPending || 0) - 1); }
      if (!state || state.ref !== ref) { flushBalance(); return; }
      if (!r || r.error) { delete state.clSent[commentId]; commentLikeFailed(r); return; }
      state.clFails = 0;
      const vd = creditVerdict('comment_like', r);
      if (r.reason === 'update_required') {
        state.canCommentLike = false;
        needUpdate(originFor('comment_like'));
        flushBalance(); drawHud(); return;
      }
      if (r.commentLike) {
        state.clDone = Number(r.commentLike.done) || 0;
        if (r.commentLike.capped) state.clCapped = true;
      }
      if (r.bonus && r.bonus.credited) { state.bonusDone = true; setDone(ref, { bonus: true }); }
      const from = originFor('comment_like');
      if (vd.outcome === 'paid') celebrate({ from, amount: (Number(rewards.commentLikeReward) || 0) + vd.bonusPaid, tickets: vd.tickets });
      else if (vd.outcome === 'gate') {
        if (r.commentLike) state.clGated = (state.clGated || 0) + 1;
        if (vd.bonusDone) state.gated.bonus = true;
        gateReject(from, vd.tickets);
      }
      else celebrate({ from, amount: vd.bonusPaid, tickets: vd.tickets });
      flushBalance();
      drawHud();
    }
    function commentLikeFailed(r) {
      if (!state) return;
      const reason = (r && (r.reason || r.error)) || 'network';
      state.clFails = (state.clFails || 0) + 1;
      state.clRetryAt = Date.now() + (NOT_EARNING.has(reason) ? LONG_BACKOFF_MS : backoffMs(state.clFails, 15000, 300000));
      showReject(reason, originFor('comment_like'), r && r.error);
      flushBalance();
      drawHud();
    }
    function scanCommentLikes() {
      if (!commentLikeOpen() || A.commentLikeConfirmNetwork) return;
      if (typeof A.commentLikeScan !== 'function') return;
      if (Date.now() < (state.clRetryAt || 0)) return;
      let rows = [];
      try { rows = A.commentLikeScan() || []; } catch (e) { return; }
      for (const c of rows) {
        if (!c || !c.id || state.clSent[c.id]) continue;
        if (A.commentLikeRequiresFlip) {
          if (state.clSeen[c.id] === undefined) { state.clSeen[c.id] = c.liked === true; continue; }
          if (state.clSeen[c.id] === true) continue;
        }
        if (c.liked !== true) continue;
        fireCommentLike(c.id);
        return;
      }
    }
    function hookCommentLike() {
      if (commentLikeHooked || typeof A.commentLikeTarget !== 'function') return;
      commentLikeHooked = true;
      document.addEventListener('click', (e) => {
        if (ownUi(e)) return;
        let t = null;
        try { t = A.commentLikeTarget(e.target); } catch (e2) { t = null; }
        if (!t || !commentLikeOpen()) return;
        noteCtl('comment_like', t);
        if (A.commentLikeConfirmNetwork) {
          pendingCommentLikeUntil = Date.now() + CL_CONFIRM_MS;
          pendingCommentLikeRef = state.ref;
          return;
        }
        for (const ms of [400, 1200, 2500]) setTimeout(scanCommentLikes, ms);
      }, true);
    }

    const knownLiked = Object.create(null);
    let knownLikedN = 0;
    let ttStateSent = 0;
    const TT_STATE_MAX = 3;
    const KNOWN_ID = /^\d{5,30}$/;
    function noteKnownLiked(d) {
      try {
        if (!A.likeKnownNetwork) return;
        const ref = d.ref == null ? '' : String(d.ref);
        if (!KNOWN_ID.test(ref)) return;
        const m = d.meta && typeof d.meta === 'object' ? d.meta : {};
        let k = knownLiked[ref];
        if (!k) {
          if (knownLikedN >= 200) return;
          k = knownLiked[ref] = { liked: false, cids: [] };
          knownLikedN++;
        }
        const liked = m.liked === true;
        if (liked) k.liked = true;
        const cids = Array.isArray(m.cids) ? m.cids : [];
        let hearted = 0;
        for (const c of cids.slice(0, 50)) {
          if (typeof c !== 'string' || !KNOWN_ID.test(c)) continue;
          hearted++;
          if (k.cids.indexOf(c) < 0 && k.cids.length < 50) k.cids.push(c);
        }
        if (state && state.ref === ref && ttStateSent < TT_STATE_MAX) {
          ttStateSent++;
          const f = m.found && typeof m.found === 'object' ? m.found : {};
          send({ type: 's2Debug', kind: 'ttstate', data: {
            ref, src: typeof m.src === 'string' ? m.src.slice(0, 12) : '',
            diggedField: f.digged === true, userDiggedField: f.userDigged === true,
            liked, hearted, likeS: state.likeS } });
        }
        applyKnownLiked();
      } catch {   }
    }
    function askKnownLiked(ref) {
      try {
        if (!A.likeKnownNetwork || !ref) return;
        window.postMessage({ rgcObsAsk: 1, kind: 'ttliked', ref: String(ref) }, location.origin);
      } catch {   }
    }
    function applyKnownLiked() {
      if (!A.likeKnownNetwork || !state || !state.ref) return;
      if (state.ref !== A.getRef()) return;
      const k = knownLiked[state.ref];
      if (!k) return;
      if (k.liked) {
        state.serverLiked = true;
        if (A.actions.like && state.likeS === 'idle' && !state.held.like && (Number(rewards.likeReward) || 0) > 0
            && Date.now() >= (state.retryAt.like || 0)) fireEngagement('like');
      }
      if (k.cids.length && A.commentLikeConfirmNetwork && commentLikeOpen() && Date.now() >= (state.clRetryAt || 0)) {
        const used = Math.max((state.clDone || 0) + (state.clPending || 0), Object.keys(state.clSent).length);
        let room = commentLikeMax() - used;
        for (const cid of k.cids) {
          if (room <= 0) break;
          if (state.clSent[cid]) continue;
          room--;
          fireCommentLike(cid);
        }
      }
    }

    const CONFIRM_WINDOW_MS = 90000;
    const FLIP_TRIES = 10, FLIP_INTERVAL_MS = 400;
    function whenFlipped(probe, onFlipped, onGiveUp) {
      let tries = 0;
      (function tick() {
        let flipped = false;
        try { flipped = !!probe(); } catch { flipped = false; }
        if (flipped) { try { onFlipped(); } catch {   } return; }
        if (++tries >= FLIP_TRIES) {
          if (typeof onGiveUp === 'function') { try { onGiveUp(); } catch {   } }
          return;
        }
        setTimeout(tick, FLIP_INTERVAL_MS);
      })();
    }
    let pendingRepostUntil = 0, pendingSendUntil = 0, intentHooked = false;
    let fbDiagSent = 0;
    const FB_DIAG_MAX = 6;
    let ttDiagSent = 0;
    let ttDiggDiagSent = 0;
    let ttNetDiagSent = 0;
    const TT_NET_DIAG_MAX = 12;
    const TT_DIAG_MAX = 4;
    const SHARE_CREDIT_DELAY_MS = 5000;
    let shareTimer = null;
    function cancelClickOnlyShare() {
      if (shareTimer) { clearTimeout(shareTimer); shareTimer = null; }
    }
    function armClickOnlyShare() {
      if (!sendCapable() || !state || state.sendS !== 'idle') return;
      const ref = state.ref;
      cancelClickOnlyShare();
      shareTimer = setTimeout(() => {
        shareTimer = null;
        if (!sendCapable() || !state || state.ref !== ref || state.sendS !== 'idle') return;
        fireEngagement('share_send');
      }, SHARE_CREDIT_DELAY_MS);
    }

    let toastObs = null, toastTimer = null;
    function stopRepostToast() {
      if (toastObs) { try { toastObs.disconnect(); } catch {   } toastObs = null; }
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    }
    function watchRepostToast() {
      if (!A.repostToastRe || toastObs) return;
      const seen = () => {
        if (!state || state.repostS !== 'idle' || Date.now() >= pendingRepostUntil) return false;
        let txt = '';
        try { txt = document.body ? document.body.innerText.slice(0, 20000) : ''; } catch { return false; }
        return A.repostToastRe.test(txt);
      };
      try {
        toastObs = new MutationObserver(() => {
          if (!seen()) return;
          stopRepostToast();
          pendingRepostUntil = 0;
          fireEngagement('repost');
        });
        toastObs.observe(document.body, { childList: true, subtree: true });
      } catch { toastObs = null; return; }
      toastTimer = setTimeout(stopRepostToast, CONFIRM_WINDOW_MS + 1000);
    }

    function hookIntent() {
      if (intentHooked) return; intentHooked = true;
      if (typeof A.repostTarget !== 'function' && typeof A.sendTarget !== 'function') return;
      document.addEventListener('click', (e) => {
        if (ownUi(e)) return;
        try {
          const rt = typeof A.repostTarget === 'function' ? A.repostTarget(e.target) : null;
          if (rt) {
            noteCtl('repost', rt.nodeType === 1 ? rt : e.target);
            pendingRepostUntil = Date.now() + CONFIRM_WINDOW_MS;
            watchRepostToast();
          }
        } catch {   }
        try {
          const st = typeof A.sendTarget === 'function' ? A.sendTarget(e.target) : null;
          if (st) {
            noteCtl('share_send', st.nodeType === 1 ? st : e.target);
            if (A.sendClickOnly) {
              armClickOnlyShare();
            } else {
              pendingSendUntil = Date.now() + CONFIRM_WINDOW_MS;
            }
          }
        } catch {   }
      }, true);
    }
    let lastTaken = null;
    const TAKEN_MEMORY_MS = 30000;
    function ownsConfirmation(kind, ref) {
      try {
        if (!ref) return false;
        if (lastTaken && lastTaken.kind === kind && lastTaken.ref === ref
            && Date.now() - lastTaken.at < TAKEN_MEMORY_MS) return true;
        if (!state || state.ref !== ref) return false;
        if (kind === 'repost') {
          if (!repostCapable()) return false;
          if (Date.now() < pendingRepostUntil) return true;
          return typeof A.isRepostedFocal !== 'function' || A.isRepostedFocal() !== null;
        }
        if (kind === 'send') return sendCapable() && Date.now() < pendingSendUntil;
        return false;
      } catch { return false; }
    }
    try { self.RGCEngage = { ownsConfirmation }; } catch {   }
    window.addEventListener('message', (e) => {
      try {
        if (e.source !== window || e.origin !== location.origin) return;
        const d = e.data;
        if (!d || d.rgcObs !== 1 || d.ok !== true || d.platform !== A.platform) return;
        if (d.kind === 'ttliked') { noteKnownLiked(d); return; }
        if (!state || !state.ref) return;
        if (d.kind === 'fbdiag') {
          try {
            if (fbDiagSent < FB_DIAG_MAX && repostCapable() && state.repostS === 'idle') {
              fbDiagSent++;
              send({
                type: 's2Debug',
                kind: 'fbrepost',
                data: {
                  name: (d.meta && d.meta.name) || '',
                  ref: state.ref,
                  armed: Date.now() < pendingRepostUntil,
                  looksJson: (d.meta && d.meta.looksJson) === true,
                  hasNameToken: (d.meta && d.meta.hasNameToken) === true,
                  path: (d.meta && d.meta.path) || '',
                  keys: (d.meta && d.meta.keys) || '',
                },
              });
            }
          } catch (e) {   }
          return;
        }
        if (d.kind === 'comment_like') {
          const cid = d.meta && typeof d.meta.commentId === 'string' ? d.meta.commentId : null;
          const okClRef = !d.ref || String(d.ref) === state.ref;
          if (A.commentLikeConfirmNetwork && okClRef && cid
              && pendingCommentLikeRef === state.ref && Date.now() < pendingCommentLikeUntil) {
            pendingCommentLikeUntil = 0;
            fireCommentLike(cid);
          }
          return;
        }
        if (d.kind === 'like') {
          const now2 = Date.now();
          const okRef = !d.ref || String(d.ref) === state.ref;
          const sameRef = !!d.ref && String(d.ref) === state.ref;
          const armed = pendingLikeRef === state.ref && now2 < pendingLikeUntil;
          if (A.likeConfirmNetwork && okRef && (armed || sameRef) && state.likeS === 'idle') {
            pendingLikeUntil = 0;
            fireEngagement('like');
          } else if (A.likeNetworkPageScoped && okRef && state.likeS === 'idle') {
            send({
              type: 's2Debug',
              kind: 'fblike',
              data: Object.assign({ ev: 'paid', ref: state.ref }, d.meta || {}),
            });
            let tapped = true;
            try { tapped = typeof A.likeIntentWithin !== 'function' || A.likeIntentWithin(20000) === true; } catch { tapped = false; }
            fireEngagement('like', tapped ? undefined : { quiet: true });
          }
          return;
        }
        if (d.kind === 'comment') {
          const okCommentRef = !d.ref || String(d.ref) === state.ref;
          if (okCommentRef && A.actions.comment && state.commentEnabled !== false && state.commentS === 'idle'
              && typeof d.txt === 'string' && passesGate(d.txt.trim())) {
            deleteReported = false;
            if (A.commentIdFromDom) {
              const txt = d.txt.trim();
              commentIdFor(txt).then((id) => fireEngagement('comment', { commentId: id, text: txt }));
            } else {
              fireEngagement('comment', { text: d.txt.trim() });
            }
          } else if (okCommentRef && A.actions.comment && state.commentEnabled !== false && state.commentS === 'idle'
              && typeof d.txt === 'string' && d.txt.trim()) {
            rejectComment(gateReason(d.txt.trim()));
          }
          return;
        }
        if (d.kind === 'comment_action') { noteCommentDelete({ net: true }); return; }
        if (d.kind === 'fbmdiag') {
          try {
            send({ type: 's2Debug', kind: 'fbmobile',
              data: Object.assign({}, d.meta || {}, { ref: state.ref, likeS: state.likeS, repostS: state.repostS }) });
          } catch (e) {   }
          return;
        }
        if (d.kind === 'ttnetdiag') {
          try {
            if (ttNetDiagSent < TT_NET_DIAG_MAX) {
              ttNetDiagSent++;
              send({ type: 's2Debug', kind: 'ttnet',
                data: Object.assign({}, d.meta || {}, { ref: state.ref, likeS: state.likeS, clDone: state.clDone }) });
            }
          } catch (e) {   }
          return;
        }
        if (d.kind === 'ttdiggdiag') {
          try {
            if (ttDiggDiagSent < TT_DIAG_MAX + 2) {
              ttDiggDiagSent++;
              send({ type: 's2Debug', kind: 'ttdigg',
                data: Object.assign({}, d.meta || {}, { ref: state.ref, likeS: state.likeS }) });
            }
          } catch (e) {   }
          return;
        }
        if (d.kind === 'ttdiag') {
          try {
            if (ttDiagSent < TT_DIAG_MAX) {
              ttDiagSent++;
              send({ type: 's2Debug', kind: 'ttcomment',
                data: { path: (d.meta && d.meta.path) || '', ref: state.ref } });
            }
          } catch (e) {   }
          return;
        }
        let ref = d.ref == null ? '' : String(d.ref);
        if (!ref && typeof A.isReposted !== 'function') ref = state.ref;
        if (!ref || ref !== state.ref) return;
        const now = Date.now();
        if (d.kind === 'repost' && repostCapable() && A.repostNetworkPageScoped
            && state.repostS === 'idle' && now >= pendingRepostUntil) {
          lastTaken = { kind: 'repost', ref, at: now };
          fireEngagement('repost');
        } else if (d.kind === 'repost' && repostCapable() && now < pendingRepostUntil) {
          pendingRepostUntil = 0;
          lastTaken = { kind: 'repost', ref, at: now };
          if (typeof A.isReposted === 'function') {
            const trust = A.repostTrustNetwork
              ? () => { if (state && state.ref === ref && state.repostS === 'idle') fireEngagement('repost'); }
              : null;
            whenFlipped(() => !!state && state.ref === ref && adapterReposted(), () => fireEngagement('repost'), trust);
          } else {
            fireEngagement('repost');
          }
        } else if (d.kind === 'send' && sendCapable() && now < pendingSendUntil) {
          pendingSendUntil = 0;
          lastTaken = { kind: 'send', ref, at: now };
          fireEngagement('share_send');
        }
      } catch {   }
    });

    function bannedHit(text) {
      const banned = (state && state.commentBannedWords) || [];
      if (!banned.length) return null;
      const lower = text.toLowerCase();
      return banned.find((w) => new RegExp(`\\b${String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(lower)) || null;
    }
    function gateReason(text) {
      if (bannedHit(text)) return 'comment_word';
      const minWords = (state && state.commentMinWords) || 0;
      if (minWords > 0) return text.split(/\s+/).filter(Boolean).length > minWords ? null : 'comment_short';
      return text.length > 5 ? null : 'comment_short';
    }
    function passesGate(text) { return !gateReason(text); }

    const COMMENT_ID_WAIT_MS = 6000;

    function commentIdFor(text) {
      if (!A.commentIdFromDom) return Promise.resolve(null);
      const started = Date.now();
      const ref0 = state ? state.ref : null;
      return new Promise((resolve) => {
        (function look() {
          if (dead) return;
          if (!state || state.ref !== ref0) { creditMovedComment(ref0); return; }
          let id = null;
          try { id = A.commentIdFromDom(text); } catch (e) { id = null; }
          if (id) return resolve(String(id));
          if (Date.now() - started > COMMENT_ID_WAIT_MS) return resolve(null);
          setTimeout(look, 400);
        })();
      });
    }

    function creditMovedComment(ref) {
      if (!ref) return;
      send({ type: 's2Engagement', platform: A.platform, action: 'comment', ref })
        .then((r) => { if (r && !r.error && r.credited) setDone(ref, { comment: true }); });
    }

    const DELETE_WINDOW_MS = 10000;
    let delMenuAt = 0, delMenuId = null;
    let delConfirmAt = 0;
    let delRemovedAt = 0, delRemovedId = null;
    let delNetAt = 0;
    let deleteReported = false;

    function noteCommentDelete(part) {
      const now = Date.now();
      if (part.menuId !== undefined) { delMenuAt = now; delMenuId = part.menuId; }
      if (part.confirm) delConfirmAt = now;
      if (part.removedId !== undefined) { delRemovedAt = now; delRemovedId = part.removedId; }
      if (part.net) delNetAt = now;
      maybeReportDelete();
    }

    function maybeReportDelete() {
      if (deleteReported) return;
      if (!state || !state.ref || state.commentS !== 'done') return;
      const now = Date.now();
      const fresh = (t) => t > 0 && now - t < DELETE_WINDOW_MS;
      if (!(fresh(delConfirmAt) && fresh(delRemovedAt) && fresh(delNetAt))) return;
      deleteReported = true;
      const commentId = delRemovedId || delMenuId || null;
      const ref = state.ref;
      state.commentS = 'voided';
      drawHud();
      setDone(ref, { comment: false, commentVoided: true });
      send({
        type: 's2CommentDeleted', platform: A.platform, ref,
        commentId: typeof commentId === 'string' ? commentId : null,
      });
    }

    function hookCommentDelete() {
      if (!A.commentDeleteHooks || commentDeleteHooked) return;
      commentDeleteHooked = true;
      document.addEventListener('click', (e) => {
        if (ownUi(e)) return;
        try {
          const t = e.target;
          if (!t || !t.closest) return;
          const menu = A.commentMenuTarget && A.commentMenuTarget(t);
          if (menu) { noteCommentDelete({ menuId: menu.id || null }); return; }
          if (A.commentConfirmTarget && A.commentConfirmTarget(t)) noteCommentDelete({ confirm: true });
        } catch (err) {   }
      }, true);
      try {
        const mo = new MutationObserver((records) => {
          if (deleteReported || !state || state.commentS !== 'done') return;
          for (const r of records) {
            for (const n of r.removedNodes) {
              if (!n || n.nodeType !== 1) continue;
              let id = null;
              try { id = A.commentIdFromNode ? A.commentIdFromNode(n) : null; } catch (e) { id = null; }
              if (id !== null) { noteCommentDelete({ removedId: id }); return; }
            }
          }
        });
        mo.observe(document.documentElement, { childList: true, subtree: true });
      } catch (err) {   }
    }

    function hookComment() {
      if (commentHooked || !A.actions.comment) return; commentHooked = true;
      if (A.commentConfirmNetwork) return;
      function trySubmit() {
        if (!state || state.commentS !== 'idle') return;
        if (state.commentEnabled === false) return;
        const txt = (A.commentText() || '').trim();
        if (!passesGate(txt)) { if (txt) rejectComment(gateReason(txt)); return; }
        fireEngagement('comment', { text: txt });
      }
      let confirmIv = null;
      function watchForPostedComment() {
        if (confirmIv || !state || state.commentS !== 'idle') return;
        const armedText = (A.commentText() || '').trim();
        if (!passesGate(armedText)) return;
        let ticks = 0;
        confirmIv = setInterval(() => {
          ticks++;
          if (!state || state.commentS !== 'idle') { clearInterval(confirmIv); confirmIv = null; return; }
          const now = (A.commentText() || '').trim();
          if (now.length === 0) { clearInterval(confirmIv); confirmIv = null; fireEngagement('comment', { text: armedText }); }
          else if (ticks > 16) { clearInterval(confirmIv); confirmIv = null; }
        }, 250);
      }
      document.addEventListener('click', (e) => {
        if (ownUi(e)) return;
        const guard = A.commentClickGuard || A.likeTarget;
        if (guard && guard.call(A, e.target)) return;
        const sub = A.commentSubmitTarget(e.target);
        if (sub) { noteCtl('comment', sub.nodeType === 1 ? sub : e.target); trySubmit(); return; }
        watchForPostedComment();
      }, true);
      if (A.submitOnEnter !== false) {
        document.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.shiftKey || ownUi(e)) return;
          if (!A.commentInputTarget || !A.commentInputTarget(e.target)) return;
          noteCtl('comment', e.target);
          trySubmit();
        }, true);
      }
      if (A.submitOnCtrlEnter) {
        document.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || ownUi(e)) return;
          if (A.commentInputTarget && !A.commentInputTarget(e.target)) return;
          noteCtl('comment', e.target);
          trySubmit();
        }, true);
      }
      document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ownUi(e)) watchForPostedComment(); }, true);
    }

    let pendingLikeUntil = 0, pendingLikeRef = '';
    function hookLike() {
      if (likeHooked || !A.actions.like || !A.likeTarget) return; likeHooked = true;
      document.addEventListener('click', (e) => {
        if (ownUi(e)) return;
        const t = A.likeTarget(e.target);
        if (!t) return;
        if (!state || state.likeS !== 'idle') return;
        if (A.likeConfirmNetwork) {
          noteCtl('like', t.nodeType === 1 ? t : e.target);
          pendingLikeUntil = Date.now() + 90 * 1000;
          pendingLikeRef = state.ref;
          return;
        }
        if (A.isLiked()) return;
        noteCtl('like', t.nodeType === 1 ? t : e.target);
        fireEngagement('like');
      }, true);
    }

    async function startWatch() {
      if (!A.actions.watch || dead) return;
      if (earnBlocked()) return;
      if (!state || state.watchStarting || state.sessionId || state.watchDone || state.watchGated) return;
      const ref = state.ref;
      state.watchStarting = true;
      let dur = 0, v = null;
      for (let i = 0; i < 5 && dur === 0; i++) {
        v = A.getVideoEl();
        dur = (v && !adPlaying(v) && isFinite(v.duration) && v.duration > 0) ? Math.round(v.duration) : 0;
        if (dur === 0) await new Promise(r => setTimeout(r, 2000));
        if (!state || state.ref !== ref || A.getRef() !== ref) { if (state && state.ref === ref) state.watchStarting = false; return; }
      }
      if (PHOTO_PLATFORM && !realVideo(v || A.getVideoEl())) { state.watchStarting = false; state.noVideoAt = Date.now(); return; }
      const s = await send({ type: 's2WatchSession', platform: A.platform, videoRef: ref, playerDuration: dur });
      if (!state || state.ref !== ref || A.getRef() !== ref) return;
      state.watchStarting = false;
      if (!s || s.error || !s.sessionId) return;
      state.sessionId = s.sessionId; state.hbInterval = s.heartbeatIntervalSec || 20;
      state.target = effectiveTarget(s.requiredWatchSeconds, s.requiredHeartbeats, state.hbInterval);
      if (s.priorSeconds) state.watched = Math.max(state.watched || 0, s.priorSeconds);
      pickVideo();
      drawHud();
    }
    const CLAIM_STOP = new Set(['no_reward', 'no_target', 'platform_disabled', 'bad_video', 'no_season', 'no_active_season']);
    async function claimWatch() {
      if (!state || state.watchDone || state.claiming || state.watchGated || state.claimStopped) return;
      if (Date.now() < (state.claimRetryAt || 0)) return;
      const ref = state.ref;
      state.lastClaimTry = Date.now();
      state.claiming = true; drawHud();
      creditsInFlight++;
      let r = null;
      try { r = await send({ type: 's2WatchClaim', platform: A.platform, videoRef: ref }); }
      finally { creditsInFlight = Math.max(0, creditsInFlight - 1); }
      const vd = creditVerdict('watch', r);
      if (!state || state.ref !== ref) {
        if (vd.outcome === 'paid' || vd.outcome === 'already') setDone(ref, { watch: true, awarded: vd.outcome === 'paid' ? vd.amount : null });
        flushBalance();
        return;
      }
      state.claiming = false;
      if (vd.outcome === 'paid' || vd.outcome === 'already') {
        state.watchDone = true;
        state.watchError = null;
        state.claimFails = 0;
        state.awarded = vd.outcome === 'paid' ? vd.amount : null;
        setDone(ref, { watch: true, awarded: state.awarded });
        if (vd.bonusDone) { state.bonusDone = true; setDone(ref, { bonus: true }); }
        if (vd.outcome === 'paid') { state.pillDone = true; state.pillDoneAmt = vd.amount; }
        updateWatchUi(true);
        celebrate({ from: eyeOrHud(), amount: (vd.outcome === 'paid' ? vd.amount : 0) + vd.bonusPaid, tickets: vd.tickets });
        if (replayAvailable() && (state.replayUsed || 0) < (state.replayMax || 0)) {
          if (vd.outcome === 'paid') state.replayRetryAt = Date.now() + 1150;
          setTimeout(() => { if (!dead && state && state.ref === ref) maybeStartReplay(); }, vd.outcome === 'paid' ? 1200 : 0);
        } else if (replayAvailable()) state.replayAllDone = true;
        releaseHeld();
      } else if (vd.outcome === 'gate') {
        state.watchGated = true;
        state.sessionId = null;
        gateReject(eyeOrHud(), vd.tickets);
      } else {
        const reason = vd.reason || 'network';
        state.watchError = reason;
        state.claimFails = (state.claimFails || 0) + 1;
        if (CLAIM_STOP.has(reason)) state.claimStopped = true;
        else state.claimRetryAt = Date.now() + backoffMs(state.claimFails, 15000, 300000);
        if (vd.tickets != null) celebrate({ amount: 0, tickets: vd.tickets });
        showReject(reason, eyeOrHud(), vd.error);
      }
      flushBalance();
      drawHud();
    }

    async function maybeStartReplay() {
      if (earnBlocked()) return;
      if (!state || !state.watchDone || !replayAvailable()) return;
      if (state.replaying || state.replayStarting || state.replayAllDone || state.replayStopped || state.watchGated) return;
      if ((state.replayUsed || 0) >= (state.replayMax || 0)) { state.replayAllDone = true; return; }
      if (Date.now() < (state.replayRetryAt || 0)) return;
      const ref = state.ref;
      state.replayStarting = true;
      if (!state.baseTarget) state.baseTarget = state.target || 0;
      const v = A.getVideoEl();
      const dur = (v && !adPlaying(v) && isFinite(v.duration) && v.duration > 0) ? Math.round(v.duration) : 0;
      const s = await send({ type: 's2WatchSession', platform: A.platform, videoRef: ref, playerDuration: dur });
      if (!state || state.ref !== ref || A.getRef() !== ref) return;
      state.replayStarting = false;
      if (!s || s.error || !s.sessionId) {
        state.replayFails = (state.replayFails || 0) + 1;
        state.replayRetryAt = Date.now() + backoffMs(state.replayFails, 15000, 300000);
        return;
      }
      state.replayFails = 0;
      state.sessionId = s.sessionId; state.hbInterval = s.heartbeatIntervalSec || state.hbInterval || 20;
      state.watched = 0;
      state.replayOpenedAt = Date.now();
      state.replayMinMs = (Number(s.requiredWatchSeconds) || 0) * 1000 + 1000;
      state.target = effectiveTarget(s.requiredWatchSeconds, s.requiredHeartbeats, state.hbInterval);
      if (!state.baseTarget) state.baseTarget = state.target;
      state.replaying = true;
      state.pillDone = false;
      state.claimFails = 0; state.claimRetryAt = 0;
      drawHud();
    }
    const REPLAY_STOP = new Set(['base_not_claimed', 'not_eligible', 'no_reward', 'no_target', 'platform_disabled']);
    async function claimReplayWatch() {
      if (!state || !state.replaying || state.claiming) return;
      if (Date.now() < (state.claimRetryAt || 0)) return;
      const readyAt = (state.replayOpenedAt || 0) + (state.replayMinMs || 0);
      if (Date.now() < readyAt) { state.claimRetryAt = readyAt; return; }
      const ref = state.ref;
      state.claiming = true; drawHud();
      creditsInFlight++;
      let r = null;
      try { r = await send({ type: 's2WatchClaim', platform: A.platform, videoRef: ref, mode: 'replay' }); }
      finally { creditsInFlight = Math.max(0, creditsInFlight - 1); }
      const vd = creditVerdict('replay', r);
      if (!state || state.ref !== ref) { flushBalance(); return; }
      state.claiming = false;
      if (vd.outcome === 'paid' || vd.outcome === 'already') {
        state.replaying = false;
        state.sessionId = null;
        state.claimFails = 0;
        state.replayUsed = r.ok ? (r.used != null ? r.used : (state.replayUsed || 0) + 1) : (state.replayMax || 0);
        if (vd.bonusDone) { state.bonusDone = true; setDone(ref, { bonus: true }); }
        if (vd.outcome === 'paid') { state.pillDone = true; state.pillDoneAmt = vd.amount; }
        updateWatchUi(true);
        celebrate({ from: eyeOrHud(), amount: (vd.outcome === 'paid' ? vd.amount : 0) + vd.bonusPaid, tickets: vd.tickets });
        if ((state.replayUsed || 0) >= (state.replayMax || 0)) state.replayAllDone = true;
        else maybeStartReplay();
      } else if (vd.outcome === 'gate') {
        state.replaying = false;
        state.sessionId = null;
        state.watchGated = true;
        gateReject(eyeOrHud(), vd.tickets);
      } else {
        const reason = vd.reason || 'network';
        if (REPLAY_STOP.has(reason)) {
          state.replaying = false;
          state.sessionId = null;
          state.replayStopped = true;
          state.replayError = reason;
        } else {
          state.claimFails = (state.claimFails || 0) + 1;
          const base = reason === 'not_qualified' && state.claimFails <= 3 ? 5000 : 15000;
          state.claimRetryAt = Date.now() + backoffMs(state.claimFails, base, 300000);
        }
        if (vd.tickets != null) celebrate({ amount: 0, tickets: vd.tickets });
        if (!REPLAY_STOP.has(reason) && reason !== 'not_qualified') showReject(reason, eyeOrHud(), vd.error);
      }
      flushBalance();
      drawHud();
    }

    let healthSampled = false;
    function scheduleHealthSample() {
      if (healthSampled) return;
      healthSampled = true;
      setTimeout(() => { sampleSelectorHealth().catch(() => {   }); }, 15000);
    }
    async function sampleSelectorHealth() {
      try {
        if (!state || !state.ref) return;
        const ref = state.ref;
        const failures = [];
        if (A.actions.watch && A.platform !== 'instagram' && A.platform !== 'facebook') {
          let v = null; try { v = A.getVideoEl(); } catch { v = null; }
          if (!v) failures.push('video');
        }
        if (A.actions.comment && state.commentEnabled !== false && typeof A.composerPresent === 'function') {
          let ok = false; try { ok = !!A.composerPresent(); } catch { ok = false; }
          if (!ok) failures.push('composer');
        }
        if (A.actions.like && typeof A.likePresent === 'function') {
          let ok = false; try { ok = !!A.likePresent(); } catch { ok = false; }
          if (!ok) failures.push('like');
        }
        if (state.canRepost && typeof A.repostPresent === 'function') {
          let ok = false; try { ok = !!A.repostPresent(); } catch { ok = false; }
          if (!ok) failures.push('repost');
        }
        if (state.canSend && typeof A.sendPresent === 'function') {
          let ok = false; try { ok = !!A.sendPresent(); } catch { ok = false; }
          if (!ok) failures.push('share');
        }
        if (state.canCommentLike && rewards.commentLikeReward > 0
            && typeof A.commentLikePresent === 'function') {
          let ok = false; try { ok = !!A.commentLikePresent(); } catch { ok = false; }
          if (!ok) failures.push('comment_like');
        }
        if (!failures.length) return;
        const cur = (await chrome.storage.local.get('selHealth')).selHealth;
        const arr = Array.isArray(cur) ? cur : [];
        for (const kind of failures) arr.push({ platform: A.platform, kind, ref });
        while (arr.length > 50) arr.shift();
        await chrome.storage.local.set({ selHealth: arr });
      } catch {   }
    }

    let mediaHooked = false;
    function hookMedia() {
      if (mediaHooked || !A.actions.watch) return;
      mediaHooked = true;
      const onMedia = (e) => {
        try {
          if (dead || !state || !hud || !state.vid) return;
          const t = e && e.target;
          if (t !== state.vid) return;
          if (e.type !== 'timeupdate') state.adNow = adPlaying(t);
          updateWatchUi(false, true);
        } catch {   }
      };
      for (const type of ['playing', 'pause', 'volumechange', 'ended', 'timeupdate']) {
        try { document.addEventListener(type, onMedia, true); } catch {   }
      }
    }
    try {
      document.addEventListener('visibilitychange', () => {
        if (dead || !state || state.ref !== A.getRef()) return;
        if (document.visibilityState === 'visible') drawHud(true);
        else updateWatchUi(false, false);
      });
      const onFs = () => {
        if (dead || !state || state.ref !== A.getRef()) return;
        if (A.actions.watch && document.visibilityState === 'visible') pickVideo();
        drawHud(true);
      };
      document.addEventListener('fullscreenchange', onFs);
      document.addEventListener('webkitfullscreenchange', onFs);
    } catch {   }

    let startSeq = 0;
    const connectPromptOff = Object.create(null);
    async function connectPrompt(ref, seq) {
      const open = await send({ type: 's2OpenTargets' });
      if (dead || seq !== startSeq || A.getRef() !== ref || state) return;
      const hit = !!(open && Array.isArray(open.targets) && open.targets.some((t) => t && t.platform === A.platform && t.ref === ref));
      if (!hit) return clearHud();
      const g = G();
      if (!g || typeof g.create !== 'function') return;
      if (!hud) { try { hud = g.create({ platform: A.platform, kick: false }); } catch { hud = null; } }
      if (!hud) return;
      connectGate = true;
      hudCall((h) => h.setCanEarn(false, { chip: copy('connectChip') }));
      let v = null;
      try { v = typeof A.getVideoEl === 'function' ? A.getVideoEl() : null; } catch { v = null; }
      hudCall((h) => h.connectCard({
        videoEl: realVideo(v) ? v : null,
        onConnect: () => { send({ type: 's2Connect' }); },
        onDismiss: () => { connectPromptOff[ref] = true; },
      }));
    }
    async function start(ref) {
      if (dead) return;
      if (!ref) { startSeq++; return clearHud(); }
      if (state && state.ref === ref) return;
      const seq = ++startSeq;
      const data = await send({ type: 's2Targets' });
      if (dead || seq !== startSeq || A.getRef() !== ref || (state && state.ref === ref)) return;
      const isX = A.platform === 'x';
      const likeR = isX && data && data.xLikeReward != null ? data.xLikeReward : (data && data.likeReward);
      const tgt = data && (data.targets || []).find((t) => t.platform === A.platform && t.ref === ref);
      const perTarget = tgt && tgt.commentReward != null ? Number(tgt.commentReward) : null;
      const commentR = perTarget != null ? perTarget
        : (isX && data && data.xCommentReward != null ? data.xCommentReward : (data && data.commentReward));
      const perTargetLike = tgt && tgt.likeReward != null ? Number(tgt.likeReward) : null;
      const likeFinal = perTargetLike != null ? perTargetLike : likeR;
      const target = data && (data.targets || []).find((t) => t.platform === A.platform && t.ref === ref && t.listed === true);
      if (!target) {
        if (data && data.connected === false && !connectPromptOff[ref]) return connectPrompt(ref, seq);
        return clearHud();
      }
      const nextRewards = {
        likeReward: likeFinal || 0,
        commentReward: commentR || 0,
        watchVideoReward: (data && data.watchVideoReward) || 0,
        watchEarlyBonus: (data && data.watchEarlyBonus) || 0,
        watchFloor: (data && data.watchVideoFloor) || 5,
        watchPerMinute: (data && data.watchTicketsPerMinute) || 1,
        repostReward: (data && data.repostReward) || 0,
        shareSendReward: (data && data.shareSendReward) || 0,
        engageBonusReward: (data && data.engageBonusReward) || 0,
        commentLikeReward: (data && data.commentLikeReward) || 0,
        commentLikeMax: (data && data.commentLikeMax) || 0,
      };
      const local = await getDone(ref);
      if (dead || seq !== startSeq || A.getRef() !== ref || (state && state.ref === ref)) return;
      rewards = nextRewards;
      const srv = target.done || {};
      const likeDone = !!srv.like;
      const commentDone = !!srv.comment;
      const watchDone = !!srv.watch;
      const repostDone = !!srv.repost;
      const sendDone = !!srv.shareSend;
      if (!srv.like && local.like) setDone(ref, { like: false });
      if (srv.like && !local.like) setDone(ref, { like: true });
      if (!srv.comment && local.comment) setDone(ref, { comment: false });
      if (srv.comment && !local.comment) setDone(ref, { comment: true });
      if (!srv.watch && local.watch) setDone(ref, { watch: false });
      if (srv.watch && !local.watch) setDone(ref, { watch: true });
      if (!srv.repost && local.repost) setDone(ref, { repost: false });
      if (srv.repost && !local.repost) setDone(ref, { repost: true });
      if (!srv.shareSend && local.send) setDone(ref, { send: false });
      if (srv.shareSend && !local.send) setDone(ref, { send: true });
      if (!srv.bonus && local.bonus) setDone(ref, { bonus: false });
      if (srv.bonus && !local.bonus) setDone(ref, { bonus: true });
      const acts = target.actions || {};
      const rep = srv.replay || null;
      const replayUsed = rep ? (rep.used || 0) : 0;
      const replayMax = rep ? (rep.max || 0) : 0;
      pendingRepostUntil = 0; pendingSendUntil = 0; pendingCommentLikeUntil = 0; pendingCommentLikeRef = '';
      try { cancelClickOnlyShare(); } catch {   }
      try { stopRepostToast(); } catch {   }
      const moved = !!state;
      state = { ref, watched: 0, target: 0, sessionId: null,
        watchDone, awarded: local.awarded != null ? local.awarded : null,
        watchPlaying: false, watchMuted: false, claiming: false,
        likeS: likeDone ? 'done' : 'idle', commentS: commentDone ? 'done' : 'idle',
        repostS: repostDone ? 'done' : 'idle', sendS: sendDone ? 'done' : 'idle',
        repostHealAt: 0,
        bonusDone: !!srv.bonus,
        canRepost: acts.repost === true, canSend: acts.shareSend === true,
        canCommentLike: acts.commentLike === true,
        clDone: Number(srv.commentLike) || 0, clCapped: false, clSent: Object.create(null), clPending: 0,
        serverLiked: false,
        clSeen: Object.create(null),
        commentMinWords: (typeof target.commentMinWords === 'number' ? target.commentMinWords : 0),
        commentEnabled: target.commentEnabled !== false,
        commentBannedWords: Array.isArray(target.commentBannedWords) ? target.commentBannedWords : [],
        replayEligible: !!(rep && rep.eligible), replayMax, replayUsed,
        replayReward: rep ? (rep.reward || 1) : 1,
        targetReward: Number(target.reward) || 0,
        replaying: false, replayStarting: false, replayAllDone: replayMax > 0 && replayUsed >= replayMax,
        baseTarget: 0,
        watchGate: data.watchGateEngagement === true,
        vid: null, hasVideo: false, pillHost: null, adNow: false,
        fails: Object.create(null), retryAt: Object.create(null), held: { like: false, comment: null },
        gated: Object.create(null), clGated: 0,
        clFails: 0, clRetryAt: 0, claimFails: 0, claimRetryAt: 0, claimStopped: false,
        watchGated: false, replayStopped: false, replayError: null, replayFails: 0, replayRetryAt: 0,
        pillDone: false, pillDoneAmt: 0, soundTipShown: false, noVideoAt: 0 };
      focus = null;
      blockedAt = 0;
      for (const k of Object.keys(ptrEl)) delete ptrEl[k];
      for (const k of Object.keys(ctl)) delete ctl[k];
      if (typeof data.tickets === 'number' && Number.isFinite(data.tickets)) bal.tickets = Math.round(data.tickets);
      lastHb = 0; hookComment(); hookCommentDelete(); hookLike(); hookCommentLike(); hookIntent(); hookMedia();
      if (A.actions.watch) pickVideo();
      if (moved && hud) {
        hudCall((h) => { h.pointTo(null); h.watchPill(null); h.relayout(); });
        pillKey = ''; watchKey = '';
      }
      ensureHud();
      if (typeof bal.tickets === 'number') hudCall((h) => h.setTotal(bal.tickets, { animate: false }));
      if (typeof data.canEarn === 'boolean') applyCanEarn(data.canEarn);
      drawHud();
      askKnownLiked(ref);
      applyKnownLiked();
      scheduleHealthSample();
      if (!state.watchDone) startWatch();
    }

    tickIv = setInterval(() => {
      if (dead) return;
      try { if (!chrome.runtime || !chrome.runtime.id) { die(); return; } } catch { die(); return; }
      if (!state || state.ref !== A.getRef()) return;
      const visible = document.visibilityState === 'visible';
      if (visible) {
        hudCall((h) => h.tick());
        if (A.actions.like && state.likeS === 'idle' && !state.held.like
            && Date.now() >= (state.retryAt.like || 0) && (focalLiked() || state.serverLiked)) fireEngagement('like');
        try { applyKnownLiked(); } catch (e) {   }
        try { scanCommentLikes(); } catch (e) {   }
        if (repostCapable() && state.repostS === 'idle' && Date.now() >= (state.repostHealAt || 0)
            && Date.now() >= (state.retryAt.repost || 0) && focalReposted()) {
          state.repostHealAt = Date.now() + 60000;
          try {
            if (A.platform === 'x' && typeof self.RGCXRepostDbg === 'function') {
              self.RGCXRepostDbg({ path: 'self-heal', ref: state.ref, url: location.pathname,
                                   focal: typeof A.isRepostedFocal === 'function' ? A.isRepostedFocal() : null,
                                   docWide: adapterReposted() });
            }
          } catch {   }
          fireEngagement('repost');
        }
      }
      if (!state) return;
      if (visible && PHOTO_PLATFORM && A.actions.watch && state.noVideoAt && !state.sessionId && !state.watchStarting
          && !state.watchDone && !state.watchGated && Date.now() - state.noVideoAt >= 10000) {
        state.noVideoAt = Date.now();
        let nv = null;
        try { nv = A.getVideoEl(); } catch { nv = null; }
        if (realVideo(nv)) startWatch();
        if (!state) return;
      }
      if (A.actions.watch) watchTick(visible);
      if (visible && state && state.ref === A.getRef()) drawHud(true);
    }, 5000);

    function watchTick(visible) {
      if (state.watchGated || canEarn === false) { state.watchPlaying = false; return; }
      if (state.watchDone && !state.replaying && !state.replayAllDone && !state.replayStopped && replayAvailable()
          && (state.replayUsed || 0) < (state.replayMax || 0) && !state.replayStarting) {
        maybeStartReplay();
        if (dead || !state) return;
      }
      if (!state.sessionId) return;
      if (state.watchDone && !state.replaying) return;
      const v = visible ? pickVideo() : state.vid;
      const live = v && !v.paused && !v.ended && !notStarted(v);
      const audible = !!(v && !v.muted && v.volume > 0);
      state.watchPlaying = !!(live && audible && visible && !state.adNow && state.hasVideo);
      state.watchMuted = !!(live && visible && !audible);
      if (!state.watchPlaying && visible && typeof A.watchDiag === 'function') {
        try { A.watchDiag(v); } catch {   }
      }
      if (state.watchPlaying) {
        state.watched = (state.watched || 0) + 5;
        const now = Date.now();
        if (now - lastHb >= (state.hbInterval || 20) * 1000) { lastHb = now; send({ type: 's2WatchHeartbeat', platform: A.platform, sessionId: state.sessionId }); }
        if (dead || !state) return;
      }
      if ((state.watched || 0) >= (state.target || 120)) {
        if (state.replaying) claimReplayWatch();
        else claimWatch();
      }
    }

    let lastUrl = location.href;
    let wdRef = null, wdTries = 0, wdNextAt = 0;
    urlIv = setInterval(() => {
      if (dead) return;
      const ref = A.getRef();
      const now = Date.now();
      if (location.href !== lastUrl) {
        lastUrl = location.href; wdRef = ref; wdTries = 0; wdNextAt = 0;
        hudCall((h) => h.relayout());
        start(ref);
        return;
      }
      if (!ref) return;
      if (ref !== wdRef) { wdRef = ref; wdTries = 0; wdNextAt = 0; }
      const established = state && state.ref === ref &&
        (!A.actions.watch || state.sessionId || state.watchDone || state.watchGated);
      if (established || wdTries >= 6 || now < wdNextAt) return;
      wdTries++; wdNextAt = now + 2000 * wdTries;
      if (!state || state.ref !== ref) start(ref);
      else if (A.actions.watch && !state.sessionId) startWatch();
    }, 1000);
    start(A.getRef());
  }

  const nextStep = (m) => planOrder(m)[0] || null;
  return { init, effectiveTarget, rejectFor, creditVerdict, planOrder, nextStep, stepList, badgeTextFor, backoffMs };
})();
