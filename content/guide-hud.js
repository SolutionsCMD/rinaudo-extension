self.RGCGuide = (function () {
  'use strict';

  const INSET = 12;
  const PILL_H = 38;
  const COUNTER_H = 58;
  const POINTER_SIZE = 72;
  const GAP = 8;
  const GLIDE_MS = 900;
  const HOVER_MS = 950;
  const REST_MS = Infinity;
  const TIP_MS = 3200;
  const TAP_HIDE_MS = 1100;
  const SETTLE_MS = 150;
  const RELAYOUT_MS = 200;
  const MAX_FLY = 5;
  const FLY_W = 78;
  const FLY_GAP_MS = 75;
  const FLY_MS = 2260;
  const FLY_EASE = 'cubic-bezier(.45,0,.35,1)';
  const GLIDE_EASE = 'cubic-bezier(.22,.9,.3,1)';
  const LABEL_MS = 2250;
  const BUMP_MS = 320;
  const SQUASH_MS = 360;
  const REJECT_MS = 1500;
  const DONE_HOLD_MS = 1100;
  const THROTTLE_MS = 60000;
  const DEDUPE_MS = 1500;
  const AMO_URL = 'https://addons.mozilla.org/firefox/addon/rinaudo-capital/';
  const PREF_SOUND = 'guideSound';
  const PREF_GUIDE = 'guideOn';
  const POS_KEY = 'hudPos:';
  const HOST_ID = 'rgc-hud';
  const DOCK_ID = 'rgc-hud-dock';
  const EYE_ID = 'rgc-eye';
  const DOCK_STYLE_ID = 'rgc-hud-dock-style';
  const CTRL_SEL = 'a,button,[role="button"],input,textarea,select,[contenteditable=""],[contenteditable="true"]';
  const KINDS = { tix: 1, mute: 1, play: 1 };
  const EYE_STATES = { counting: 1, paused: 1, muted: 1, hidden: 1, ad: 1, gate: 1, done: 1, starting: 1 };

  const FALLBACK = {
    youtube: [56, 0, 48],
    tiktok: [60, 72, 56],
    instagram: [0, 72, 52],
    facebook: [56, 0, 56],
    x: [0, 0, 53],
    reddit: [56, 0, 56],
  };

  const COPY = Object.freeze({
    commentGate: "That comment didn't count as meaningful. Try reacting to something in the video.",
    commentShort: 'Try writing a longer comment.',
    commentWording: 'Try different wording.',
    commentGeneric: "That one didn't count. Try making it more specific.",
    commentCopy: 'Try writing it in your own words.',
    link: 'Link your Kick account to earn tickets. Open the extension menu to link it.',
    update: 'Update the extension to earn this. Tap the version at the bottom.',
    connect: 'Connect the extension to start earning.',
    notEarning: "This post isn't earning right now.",
    network: "Couldn't reach the server, retrying.",
    tapForSound: 'Tap the video to turn the sound on.',
    tapVideoThenSpeaker: 'Tap the video, then the speaker.',
    watchFirst: 'Watch first, then like and comment.',
    ad: 'An ad is playing. Watch time starts again when his video does.',
    linkChip: 'Link Kick',
    connectChip: 'Connect',
  });

  const REASONS = {
    counting: '',
    paused: 'paused',
    muted: 'muted',
    hidden: 'come back',
    ad: 'ad playing, wait',
    gate: 'link Kick to earn',
    starting: 'starting again',
    done: '',
  };

  const OWN = typeof WeakSet === 'function' ? new WeakSet() : null;
  let live = null;


  function burstPlan(amount) {
    const n = Math.max(0, Math.round(Number(amount) || 0));
    const k = Math.min(Math.max(n, 1), MAX_FLY);
    const plan = [];
    for (let i = 0; i < k - 1; i++) plan.push(1);
    plan.push(n - (k - 1));
    return plan;
  }

  function stepsProgress(steps) {
    const list = Array.isArray(steps) ? steps.filter((s) => s && s.count !== false) : [];
    const done = list.filter((s) => !!s.done && !s.voided).length;
    return { done, total: list.length, text: list.length ? done + '/' + list.length : '' };
  }

  function fmtLeft(sec) {
    const s = Math.max(0, Math.ceil(Number(sec) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function watchReason(state) {
    return Object.prototype.hasOwnProperty.call(REASONS, state) ? REASONS[state] : '';
  }

  function watchTipText(amount, secondsLeft) {
    const n = Math.round(Number(amount) || 0);
    const pays = n > 0 ? 'earn +' + n : 'earn tickets';
    const left = secondsLeft == null || !Number.isFinite(Number(secondsLeft)) ? '' : ' ' + fmtLeft(secondsLeft) + ' left.';
    return 'Watch with sound on and this tab open to ' + pays + '.' + left;
  }

  function doneText(step) {
    const n = Number(step && step.collected != null ? step.collected : step && step.amount);
    return Number.isFinite(n) && n > 0 ? 'Done. +' + Math.round(n) + ' collected.' : 'Done.';
  }

  function isOwnNode(n) {
    if (!n || typeof n !== 'object') return false;
    if (OWN && OWN.has(n)) return true;
    const id = n.id;
    return id === HOST_ID || id === DOCK_ID || id === EYE_ID;
  }

  function ownsEvent(e) {
    try {
      if (!e) return false;
      if (typeof e.composedPath === 'function') {
        const path = e.composedPath() || [];
        for (let i = 0; i < path.length; i++) if (isOwnNode(path[i])) return true;
        return false;
      }
      for (let n = e.target, i = 0; n && i < 200; i++) {
        if (isOwnNode(n)) return true;
        n = n.parentNode && n.parentNode.nodeType === 11 ? n.parentNode.host : n.parentNode;
      }
    } catch (_) {   }
    return false;
  }


  const env = () => ({
    W: typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : {}),
    D: typeof document !== 'undefined' ? document : null,
  });
  const now = () => (typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
    ? performance.now() : Date.now());
  function gcs(el) {
    try {
      const { W } = env();
      const f = W.getComputedStyle || (typeof getComputedStyle === 'function' ? getComputedStyle : null);
      return f ? f.call(W, el) : null;
    } catch (_) { return null; }
  }
  function viewW() {
    const { W, D } = env();
    const de = D && D.documentElement;
    return Math.min(W.innerWidth || Infinity, (de && de.clientWidth) || Infinity) || W.innerWidth || 1024;
  }
  function viewH() {
    const { W, D } = env();
    const de = D && D.documentElement;
    return Math.min(W.innerHeight || Infinity, (de && de.clientHeight) || Infinity) || W.innerHeight || 768;
  }
  function rectOk(r) { return !!r && r.width > 0 && r.height > 0; }
  function composedParent(n) {
    if (!n) return null;
    if (n.parentElement) return n.parentElement;
    const p = n.parentNode;
    return p && p.nodeType === 11 && p.host ? p.host : null;
  }
  function deepHit(x, y) {
    const { D } = env();
    if (!D || typeof D.elementFromPoint !== 'function') return undefined;
    let hit = D.elementFromPoint(x, y);
    for (let i = 0; hit && hit.shadowRoot && i < 8; i++) {
      const sr = hit.shadowRoot;
      if (typeof sr.elementFromPoint !== 'function') break;
      const inner = sr.elementFromPoint(x, y);
      if (!inner || inner === hit) break;
      hit = inner;
    }
    return hit;
  }

  function canPoint(el, scope, allowFaded) {
    try {
      if (!el || el.nodeType !== 1) return { ok: false, reason: 'none' };
      if (el.isConnected === false) return { ok: false, reason: 'detached' };
      const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!rectOk(r)) return { ok: false, reason: 'no-size' };
      const vw = viewW(), vh = viewH();
      if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return { ok: false, reason: 'offscreen' };
      const cs = gcs(el);
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse')) {
        return { ok: false, reason: 'hidden' };
      }
      for (let n = el, i = 0; n && n.nodeType === 1 && i < 40; n = composedParent(n), i++) {
        const s = i === 0 ? cs : gcs(n);
        if (!s) continue;
        if (s.display === 'none') return { ok: false, reason: 'hidden' };
        const op = parseFloat(s.opacity);
        if (!allowFaded && Number.isFinite(op) && op < 0.05) return { ok: false, reason: 'transparent' };
      }
      const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
      const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const hit = deepHit(cx, cy);
      if (hit === undefined) return { ok: true, rect: r, unverified: true };
      if (!hit) return { ok: false, reason: 'covered' };
      let sc = null;
      if (scope && scope.nodeType === 1 && String(el.tagName || '').toUpperCase() === 'VIDEO') {
        for (let n = el, i = 0; n && i < 200; n = composedParent(n), i++) if (n === scope) { sc = scope; break; }
      }
      for (let n = hit, i = 0; n && i < 200; n = composedParent(n), i++) {
        if (n === el || n === sc) return { ok: true, rect: r };
      }
      return { ok: false, reason: 'covered' };
    } catch (_) {
      return { ok: false, reason: 'error' };
    }
  }


  const HOST_CSS = 'all:initial!important;position:fixed!important;left:0!important;top:0!important;'
    + 'width:0!important;height:0!important;overflow:visible!important;margin:0!important;padding:0!important;'
    + 'border:0!important;display:block!important;pointer-events:none!important;z-index:2147483647!important;'
    + 'transform:none!important;opacity:1!important;visibility:visible!important';
  const DOCK_HOST_CSS = 'all:initial!important;position:absolute!important;left:' + INSET + 'px!important;top:'
    + INSET + 'px!important;width:auto!important;height:auto!important;margin:0!important;padding:0!important;'
    + 'border:0!important;display:block!important;pointer-events:none!important;z-index:201!important;'
    + 'transform:none!important;opacity:1;visibility:visible!important';
  const EYE_HOST_CSS = 'all:initial!important;position:absolute!important;top:' + INSET + 'px!important;right:'
    + INSET + 'px!important;left:auto!important;bottom:auto!important;width:auto!important;height:auto!important;'
    + 'margin:0!important;padding:0!important;border:0!important;display:block!important;'
    + 'pointer-events:none!important;z-index:2147483000!important;transform:none!important;'
    + 'opacity:1!important;visibility:visible!important';

  function css(A) {
    const pd = (A.dims && A.dims.pointer) || [75, 96];
    const tip = A.tip || [0.026, 0.009];
    const ar = pd[0] / pd[1];
    const rw = ar < 1 ? POINTER_SIZE * ar : POINTER_SIZE, rh = ar < 1 ? POINTER_SIZE : POINTER_SIZE / ar;
    const tx = +(tip[0] * rw).toFixed(2), ty = +(tip[1] * rh).toFixed(2);
    const R = ':not(.rest):not(.hide)';
    return ':host{all:initial}'
      + '.w{all:initial;display:block;position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;'
      + 'font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:18px;'
      + 'font-weight:400;font-style:normal;letter-spacing:normal;word-spacing:normal;text-transform:none;text-indent:0;'
      + 'direction:ltr;text-align:left;white-space:normal;color:#14171c;-webkit-text-size-adjust:none;text-size-adjust:none;'
      + '-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased;box-sizing:border-box}'
      + '.w.solo{position:relative;width:auto;height:auto}'
      + '.w *{box-sizing:border-box}'
      + 'img{display:block;border:0;max-width:none;user-select:none;-webkit-user-select:none;-webkit-user-drag:none;pointer-events:none}'
      + 'button{font:inherit;color:inherit;margin:0;-webkit-appearance:none;appearance:none;touch-action:manipulation}'
      + '.dock{position:absolute;left:' + INSET + 'px;top:' + INSET + 'px;pointer-events:none;z-index:1}.dock.open{z-index:3}'
      + '.solo .dock{position:relative;left:0;top:0}'
      + '.pill{position:relative;display:flex;align-items:center;gap:10px;height:' + COUNTER_H + 'px;width:max-content;transform-origin:28px center;'
      + 'padding:5px 14px 7px 8px;border:2px solid #48d89f;border-radius:16px;background:linear-gradient(115deg,#244c51,#060b15 70%);box-shadow:0 5px 0 #07100f,0 8px 20px #0008,0 0 16px #48d89f35;'
      + 'color:#f3cc5c;font-size:14px;line-height:18px;font-weight:800;white-space:nowrap;cursor:pointer;user-select:none;'
      + '-webkit-user-select:none;touch-action:none;pointer-events:auto}'
      + '.pill::before{content:"";position:absolute;left:-3px;right:-3px;top:-3px;bottom:-3px}'
      + '.pill .ic{position:relative;width:48px;height:42px;flex:none}'
      + '.pill .ic img{width:48px;height:42px;object-fit:contain}'
      + '.balance{display:flex;flex-direction:column;gap:0;min-width:56px}.caption{font-size:10px;line-height:12px;letter-spacing:1.5px;color:#a3e7ce;font-weight:900}'
      + '.num{position:relative;display:inline-block;font-size:28px;line-height:29px;font-weight:950;font-variant-numeric:tabular-nums;text-shadow:0 2px 0 #0007}'
      + '.num .n{display:inline-block}.num .r{position:absolute;left:0;top:0;color:#fff4c1;opacity:0}'
      + '.num.unk{display:none}'
      + '.chip{border:2px solid #48d89f55;border-radius:9px;padding:2px 8px;background:#48d89f1f;color:#91f5c8;font-size:14px;line-height:22px;font-weight:900}'
      + '.chip.complete{background:#f3cc5c;color:#060b15;border-color:#f3cc5c}.chip.red{background:#502438;color:#ffc4d8;border-color:#ff77bd}'
      + '.chip.off,.kick .chip:not(.red){display:none}'
      + '.meter{position:absolute;left:69px;right:12px;bottom:3px;height:4px;border-radius:3px;background:#ffffff20;overflow:hidden;pointer-events:none}'
      + '.meter.off,.kick .meter{display:none}.fill{display:block;width:100%;height:100%;background:linear-gradient(90deg,#48d89f,#63deff);transform:scaleX(0);transform-origin:left center;transition:transform .45s ease}'
      + '.pill.complete{border-color:#f3cc5c}.pill.complete .fill{background:#f3cc5c}'
      + '.flash{position:absolute;inset:-2px;border:3px solid #fff2a2;border-radius:16px;background:linear-gradient(115deg,#fff3a988,#ffbd3933);box-shadow:0 0 30px #ffce6388;opacity:0;pointer-events:none}'
      + '.impact{position:absolute;inset:-8px;border:3px solid #f3cc5c;border-radius:20px;box-shadow:0 0 22px #f3cc5caa;opacity:0;pointer-events:none}'
      + '.win{display:none;position:absolute;left:0;top:0;width:440px;max-width:calc(100vw - 48px);padding:20px 24px;border:3px solid #fff1a0;border-radius:24px;background:linear-gradient(125deg,#246c52,#060b15 75%);box-shadow:0 8px 0 #081715,0 0 48px #f3cc5c77,0 16px 40px #0009;color:#fff7d9;pointer-events:none;z-index:6;text-align:center}'
      + '.win.show{display:flex;align-items:center;justify-content:center;gap:18px}.win img{width:64px;height:64px}.win strong{display:block;font-size:38px;line-height:44px;font-weight:950;text-shadow:0 3px 0 #0008}.win span{display:block;margin-top:6px;font-size:19px;line-height:25px;font-weight:900;color:#f3cc5c}'
      + '.kick .pill{pointer-events:none;cursor:default}'
      + '.panel{display:none;margin-top:8px;width:300px;width:min(300px,calc(100vw - 16px));overflow:auto;'
      + 'overscroll-behavior:contain;-webkit-overflow-scrolling:touch;background:#060b15;border:1px solid #48d89f66;color:#f2f6ff;border-radius:14px;padding:10px;'
      + 'box-shadow:0 10px 28px rgba(0,0,0,.5);pointer-events:auto;font-size:13px;line-height:17px;font-weight:700}'
      + '.open .panel{display:block}'
      + '.panelhead{padding:3px 4px 10px}.panelhead strong{display:block;font-size:17px;line-height:23px;color:#f3cc5c}.panelhead span{font-size:11px;color:#b0c2d8}'
      + '.warn{margin:2px 2px 6px;padding:8px 10px;border-radius:10px;background:#fff4e5;color:#8a4b00;font-size:13px;line-height:17px;font-weight:700}'
      + '.step{display:flex;align-items:center;gap:9px;min-height:54px;margin:5px 0;padding:8px;border:1px solid #63deff40;border-left:3px solid #63deff;background:#63deff0e;border-radius:10px;cursor:pointer}'
      + '.step:nth-child(3n+2){border-color:#c3a1ff40;border-left-color:#c3a1ff;background:#c3a1ff0d}.step:nth-child(3n+3){border-color:#ff77bd40;border-left-color:#ff77bd;background:#ff77bd0d}'
      + '.step .si{width:30px;height:30px;border-radius:8px;background:#ffffff16;flex:none;display:flex;align-items:center;justify-content:center}'
      + '.step .si img{max-width:26px;max-height:26px;object-fit:contain}'
      + '.step .tx{flex:1;min-width:0}'
      + '.step .hn{display:block;margin-top:2px;font-size:11px;line-height:14px;font-weight:600;color:#b0c2d8}'
      + '.step .amt{padding:3px 7px;border-radius:6px;background:#f3cc5c1f;font-weight:900;color:#f3cc5c;white-space:nowrap}'
      + '.step.done{border-color:#48d89f66;border-left-color:#48d89f;background:#48d89f18}.step.done .lb{color:#baffdf}.step.done .hn{color:#8de8bc}.step.done .amt{color:#060b15;background:#48d89f}.step.done .si{background:none}'
      + '.step.voided{border-color:#748399;background:#ffffff08}.step.voided .amt,.step.pending .amt{color:#bdc8d8;background:#ffffff12}'
      + '.foot{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between;border-top:1px solid #ffffff20;'
      + 'margin-top:8px;padding:10px 4px 2px;font-size:12px;line-height:16px;font-weight:600;color:#b0c2d8}'
      + '.foot button{position:relative;border:1px solid #ffffff20;border-radius:999px;background:#152331;color:#d7f6eb;padding:4px 10px;'
      + 'font-size:12px;line-height:16px;font-weight:700;cursor:pointer}'
      + '.foot button::before{content:"";position:absolute;left:-2px;right:-2px;top:-10px;bottom:-10px}'
      + '.foot .ver{background:none;color:#8a8f98;padding:4px 2px;cursor:default}'
      + '.foot .ver.upd{background:#E8B339;color:#0E1B2C;padding:4px 10px;cursor:pointer}'
      + '@media (hover:hover) and (pointer:fine){.step:hover{background:#ffffff15}.step.done:hover{background:#48d89f28}.foot button:hover{background:#254536}'
      + '.foot .ver:hover{background:none}.foot .ver.upd:hover{background:#F4C95A}}'
      + '.foot .rep{flex-basis:100%;background:none;color:#8a8f98;text-decoration:underline;padding:4px 2px;text-align:center}.foot .rep.off{display:none}'
      + '.tip .tr{display:none;margin-top:4px;font-size:12px;font-weight:700;color:#b3002a;text-decoration:underline;cursor:pointer}'
      + '.tip.rep .tr{display:block}'
      + '.guide{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2;opacity:1;transition:opacity .25s}'
      + '.guide.hide{opacity:0}.guide.none{display:none}'
      + '.ptr{position:absolute;left:' + (-tx) + 'px;top:' + (-ty) + 'px;width:72px;height:72px;pointer-events:none}'
      + '.ptr .art{position:absolute;left:0;top:0;width:72px;height:72px;object-fit:contain;object-position:0 0;'
      + 'filter:drop-shadow(0 6px 8px #0009) drop-shadow(0 0 5px #fff2a266)}'
      + '.rip{position:absolute;left:-35px;top:-35px;width:70px;height:70px;opacity:0;pointer-events:none;filter:drop-shadow(0 0 12px #f3cc5c)}'
      + '.rip img{width:100%;height:100%;object-fit:contain}'
      + '.guide.hover' + R + ' .ptr{animation:rgcBob .95s ease-in-out infinite}'
      + '.guide.hover' + R + ' .art{animation:rgcPress .95s ease-in-out infinite;transform-origin:0 0}'
      + '.guide.hover' + R + ' .rip{animation:rgcRip .95s ease-out infinite}'
      + '@keyframes rgcBob{0%,100%{transform:translateY(0) rotate(0)}45%{transform:translateY(-14px) rotate(-5deg)}70%{transform:translateY(2px) rotate(3deg)}}'
      + '@keyframes rgcPress{0%,75%,100%{transform:scale(1)}12%{transform:scale(.82,1.1)}28%{transform:scale(1.14,.94)}}'
      + '@keyframes rgcRip{0%{transform:scale(.65);opacity:.95}65%{opacity:.6}100%{transform:scale(1.55);opacity:0}}'
      + '.side{position:absolute;left:36px;top:-104px;opacity:0;transform:scale(.7);transition:opacity .2s,transform .2s}'
      + '.guide.below .side{top:66px}.guide.flipx .side{left:auto;right:36px}'
      + '.guide.hover .side{opacity:1;transform:scale(1)}'
      + '.side>*{display:none}.guide.k-mute .spk,.guide.k-tix .hov{display:block}'
      + '.hov{width:110px;filter:drop-shadow(0 4px 14px #f3cc5c99)}'
      + '.guide.hover' + R + ' .hov .t{animation:rgcFloat 1.1s ease-in-out infinite}'
      + '@keyframes rgcFloat{0%,100%{transform:translateY(0) rotate(-5deg) scale(1)}50%{transform:translateY(-12px) rotate(5deg) scale(1.08)}}'
      + '.tk{position:relative;width:100%}.tk img{width:100%;height:auto}'
      + '.tk b{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;'
      + 'font-size:36px;line-height:38px;font-weight:950;color:#fff;text-shadow:0 3px 0 #805500,0 0 3px #000}'
      + '.spk{position:relative;width:80px;height:64px}'
      + '.spk img{position:absolute;left:0;top:0;width:80px;height:64px;object-fit:contain}.spk .u{opacity:0}'
      + '.guide.hover' + R + ' .spk .m{animation:rgcSpkM 1.6s ease-in-out infinite}'
      + '.guide.hover' + R + ' .spk .u{animation:rgcSpkU 1.6s ease-in-out infinite}'
      + '@keyframes rgcSpkM{0%,40%{opacity:1}50%,90%{opacity:0}100%{opacity:1}}'
      + '@keyframes rgcSpkU{0%,40%{opacity:0}50%{opacity:1;transform:scale(1.12)}60%,90%{opacity:1;transform:scale(1)}100%{opacity:0}}'
      + '.fx{position:absolute;left:0;top:0;width:' + FLY_W + 'px;opacity:0;pointer-events:none;z-index:3;will-change:transform,opacity}'
      + '.fxl,.fxl *{pointer-events:none!important}.fxl{position:absolute;left:0;top:0;width:0;height:0;overflow:visible;z-index:4}'
      + '.fx img{width:100%;height:auto;filter:drop-shadow(0 4px 6px #0008)}'
      + '.confetti,.burst{position:absolute;left:0;top:0;width:20px;height:20px;opacity:0;pointer-events:none;z-index:3;will-change:transform,opacity}.confetti img,.burst img{width:100%;height:100%}.burst{width:360px;height:360px;z-index:2}'
      + '.lbl{position:absolute;left:0;top:0;width:240px;padding:12px 18px 16px;border:3px solid #fff1a0;border-radius:24px;background:linear-gradient(125deg,#277452,#091527 80%);text-align:center;font-weight:950;color:#fff0a9;white-space:nowrap;'
      + 'box-shadow:0 7px 0 #09251c,0 0 44px #ffd15b99,0 12px 28px #0009;text-shadow:0 4px 0 #5e3c10;opacity:0;pointer-events:none;z-index:5;will-change:transform,opacity}.lbl b{display:block;font-size:68px;line-height:72px;letter-spacing:-3px}.lbl span{display:block;font-size:21px;line-height:25px;letter-spacing:2px;color:#fff5cc}.lbl .hype{display:block;margin-bottom:3px;font-size:23px;line-height:28px;letter-spacing:0;color:#97ffd7;text-shadow:0 2px 0 #063426}'
      + '.rej{position:absolute;left:0;top:0;width:100px;opacity:0;pointer-events:none;z-index:3}.rej img{width:100%;height:auto}'
      + '.tip{position:absolute;left:0;top:0;z-index:4;width:250px;max-width:calc(100vw - 16px);min-height:78px;'
      + 'padding:14px 16px 26px;display:flex;align-items:center;gap:10px;color:#14171c;font-size:13px;line-height:17px;'
      + 'font-weight:700;opacity:0;visibility:hidden;transform:translateY(4px);pointer-events:none;'
      + 'transition:opacity .15s,transform .15s,visibility 0s linear .15s}'
      + '.tip.show{opacity:1;visibility:visible;transform:none;pointer-events:auto;transition:opacity .15s,transform .15s}'
      + '.tip.below{padding:26px 16px 14px}'
      + '.tip .bg{position:absolute;left:0;top:0;width:100%;height:100%;z-index:-1}'
      + '.tip.below .bg{transform:scaleY(-1)}'
      + '.tip .ti{width:30px;height:30px;object-fit:contain;flex:none}.tip .ti.off{display:none}'
      + '.tip .tt{flex:1;min-width:0}.tip .tx{display:block}'
      + '.epill{position:absolute;left:0;top:0;display:flex;align-items:center;gap:8px;height:' + PILL_H + 'px;width:max-content;'
      + 'padding:4px 10px 6px 5px;border:1px solid #63deff;border-radius:12px;background:linear-gradient(110deg,#163b43,#060b15);box-shadow:0 4px 14px #0007;'
      + 'color:#c0fff0;font-size:13px;line-height:18px;font-weight:800;white-space:nowrap;pointer-events:none;z-index:1;'
      + 'transform:translateX(-100%)}'
      + '.solo .epill{position:relative;transform:none}'
      + '.epill.tap{pointer-events:auto;cursor:pointer}.epill.tap::before{content:"";position:absolute;left:-3px;right:-3px;top:-3px;bottom:-3px}'
      + '.epill.gone{display:none}.epill.mv{visibility:hidden}'
      + '.eye{position:relative;width:34px;height:28px;flex:none;border-radius:8px;background:#48d89f}'
      + '.eye img{position:absolute;left:0;top:0;width:34px;height:28px;object-fit:contain}'
      + '.eye .c,.eye .wt,.eye .tt2{opacity:0}'
      + '.epill.off .eye .o{opacity:0}.epill.off .eye .c{opacity:1}'
      + '.epill.ad .eye .o,.epill.ad .eye .c{opacity:0}.epill.ad .eye .wt{opacity:1}'
      + '.epill.done .eye .o,.epill.done .eye .c,.epill.done .eye .wt{opacity:0}.epill.done .eye .tt2{opacity:1}'
      + '.epill.blink .eye{animation:rgcBlink .6s ease}'
      + '@keyframes rgcBlink{0%{transform:scaleY(1)}30%{transform:scaleY(.15)}60%{transform:scaleY(1.1)}100%{transform:scaleY(1)}}'
      + '.epill .lft:empty,.epill .why:empty{display:none}'
      + '.epill .meter{left:47px;right:9px}.epill .fill{transition:transform .85s linear}.reward{font-size:10px;line-height:16px;padding:0 5px;border-radius:5px;background:#f3cc5c;color:#060b15}.reward:empty{display:none}'
      + '.epill.off{border-color:#ff77bd}.epill.off .eye{background:#b7a1d2}.epill.off .fill{background:#b7a1d2}.epill.done{background:linear-gradient(110deg,#ffeaa3,#f3cc5c);border-color:#fff3be;color:#060b15}.epill.done .eye{background:#060b1514}.epill.done .fill{background:#936714}.epill.done .reward{display:none}'
      + '.why{color:#ffc1d9}.why.soft{color:#c7c2dc}'
      + '.pgh *{animation-play-state:paused!important}'
      + '@media (prefers-reduced-motion:reduce){.w *{animation:none!important;transition:none!important}}';
  }


  function create(opts) {
    opts = opts || {};
    const { W, D } = env();
    if (!D || typeof D.createElement !== 'function') return null;
    if (live) { try { live.destroy(); } catch (_) {   } }
    removeOrphans(D);

    const platform = String(opts.platform || '');
    const kick = !!opts.kick;
    const A = self.RGCGuideAssets || { img: {}, dims: {}, tip: [0.026, 0.009], coinMp3: '' };
    const IMG = A.img || {};

    let destroyed = false;
    const timers = new Set();
    const intervals = new Set();
    const rafs = new Set();
    const anims = new Set();
    const offs = new Set();

    function later(fn, ms) {
      const id = setTimeout(() => { timers.delete(id); if (!destroyed) fn(); }, ms);
      timers.add(id);
      return id;
    }
    function cancel(id) { if (id != null) { clearTimeout(id); timers.delete(id); } return null; }
    function every(fn, ms) { const id = setInterval(fn, ms); intervals.add(id); return id; }
    function stopEvery(id) { if (id != null) { clearInterval(id); intervals.delete(id); } return null; }
    function oneFrame(fn) {
      if (typeof requestAnimationFrame === 'function') {
        let id = null;
        id = requestAnimationFrame(() => { rafs.delete(id); if (!destroyed) fn(); });
        rafs.add(id);
        return () => {
          if (!rafs.has(id)) return;
          rafs.delete(id);
          try { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id); } catch (_) {   }
        };
      }
      const t = later(fn, 16);
      return () => cancel(t);
    }
    function on(t, type, fn, o) {
      if (!t || typeof t.addEventListener !== 'function') return () => {};
      try { t.addEventListener(type, fn, o); } catch (_) { return () => {}; }
      const off = () => { offs.delete(off); try { t.removeEventListener(type, fn, o); } catch (_) {   } };
      offs.add(off);
      return off;
    }
    function anim(el, kf, o, done) {
      if (!el || typeof el.animate !== 'function') { if (done) done(false); return null; }
      let a = null;
      try { a = el.animate(kf, o); } catch (_) { if (done) done(false); return null; }
      anims.add(a);
      let fired = false;
      const end = (ok) => { if (fired) return; fired = true; anims.delete(a); if (done) done(ok); };
      a.onfinish = () => end(true);
      a.oncancel = () => end(false);
      return a;
    }
    function mk(tag, cls, text) {
      const e = D.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    }
    function img(src, cls) {
      const i = mk('img', cls);
      i.alt = '';
      try { i.decoding = 'async'; } catch (_) {   }
      if (src) i.src = src;
      return i;
    }
    function styleEl() { const s = mk('style'); s.textContent = css(A); return s; }
    function stopBubble(root) {
      ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchmove', 'touchend', 'wheel', 'dblclick']
        .forEach((t) => on(root, t, (e) => { try { e.stopPropagation(); } catch (_) {   } }, { passive: true }));
    }
    const docHidden = () => !!D && (D.visibilityState === 'hidden' || D.hidden === true);
    const fsEl = () => (D && (D.fullscreenElement || D.webkitFullscreenElement)) || null;
    const coarse = () => { try { return !!(W.matchMedia && W.matchMedia('(pointer:coarse)').matches); } catch (_) { return false; } };
    const narrow = () => viewW() < 700;

    let reduced = false;
    let mq = null;
    try { mq = W.matchMedia ? W.matchMedia('(prefers-reduced-motion: reduce)') : null; reduced = !!(mq && mq.matches); } catch (_) { mq = null; }
    const motionOK = () => !reduced && !docHidden();

    function home() {
      const b = D.body;
      if (b) {
        const cs = gcs(b);
        if (!cs || ((!cs.transform || cs.transform === 'none') && (!cs.filter || cs.filter === 'none')
          && (!cs.perspective || cs.perspective === 'none'))) return b;
      }
      return D.documentElement || b;
    }

    const host = mk('div');
    host.id = HOST_ID;
    host.style.cssText = HOST_CSS;
    if (OWN) OWN.add(host);
    const root = host.attachShadow({ mode: 'open' });
    const wrap = mk('div', 'w' + (kick ? ' kick' : ''));
    root.appendChild(styleEl());
    root.appendChild(wrap);
    stopBubble(wrap);

    const dockEl = mk('div', 'dock');
    const pill = mk('div', 'pill');
    try { pill.setAttribute('aria-label', 'Your tickets. Tap to see what this post pays.'); } catch (_) {   }
    const icBox = mk('span', 'ic');
    const icImg = img(IMG.total);
    icBox.appendChild(icImg);
    const numEl = mk('span', 'num unk');
    const numN = mk('span', 'n');
    const numR = mk('span', 'r');
    numEl.appendChild(numN); numEl.appendChild(numR);
    const chip = mk('span', 'chip off');
    const balance = mk('span', 'balance');
    balance.appendChild(mk('span', 'caption', 'TICKETS')); balance.appendChild(numEl);
    const progress = mk('span', 'meter off');
    const progressFill = mk('span', 'fill'); progress.appendChild(progressFill);
    const impact = mk('span', 'impact');
    const flash = mk('span', 'flash');
    pill.appendChild(icBox); pill.appendChild(balance); pill.appendChild(chip); pill.appendChild(progress); pill.appendChild(flash); pill.appendChild(impact);
    const win = mk('div', 'win');
    const winBody = mk('div');
    const winAmount = mk('span');
    winBody.appendChild(mk('strong', null, 'All done!')); winBody.appendChild(winAmount);
    win.appendChild(img(IMG.check)); win.appendChild(winBody);
    const panel = mk('div', 'panel');
    const panelHead = mk('div', 'panelhead');
    panelHead.appendChild(mk('strong', null, 'Earn tickets'));
    panelHead.appendChild(mk('span', null, 'Pick a step. Grab the tickets.'));
    const list = mk('div', 'list');
    const foot = mk('div', 'foot');
    const sndBtn = mk('button', 'snd'); sndBtn.type = 'button';
    const gdBtn = mk('button', 'gd'); gdBtn.type = 'button';
    const verBtn = mk('button', 'ver'); verBtn.type = 'button'; verBtn.disabled = true;
    const repBtn = mk('button', 'rep off', 'Report a problem'); repBtn.type = 'button';
    foot.appendChild(sndBtn); foot.appendChild(gdBtn); foot.appendChild(verBtn); foot.appendChild(repBtn);
    panel.appendChild(panelHead); panel.appendChild(list); panel.appendChild(foot);
    dockEl.appendChild(pill);
    if (!kick) dockEl.appendChild(panel);
    wrap.appendChild(dockEl);

    const guide = mk('div', 'guide hide none');
    const side = mk('div', 'side');
    const spk = mk('div', 'spk');
    spk.appendChild(img(IMG.mute, 'm')); spk.appendChild(img(IMG.sound, 'u'));
    const hov = mk('div', 'hov');
    const hovT = mk('div', 't');
    const hovTk = mk('div', 'tk');
    const hovN = mk('b', null, '+1');
    hovTk.appendChild(img(IMG.ticket)); hovTk.appendChild(hovN);
    hovT.appendChild(hovTk); hov.appendChild(hovT);
    side.appendChild(spk); side.appendChild(hov);
    const ptrEl = mk('div', 'ptr');
    const rip = mk('span', 'rip');
    rip.appendChild(img(IMG.ripple));
    ptrEl.appendChild(img(IMG.pointer, 'art'));
    guide.appendChild(rip); guide.appendChild(side); guide.appendChild(ptrEl);
    wrap.appendChild(guide);

    const fxLayer = mk('div', 'fxl');
    wrap.appendChild(fxLayer);
    const tipEl = mk('div', 'tip');
    const tipBg = img(IMG.card, 'bg');
    const tipIc = img('', 'ti off');
    const tipTx = mk('span', 'tx');
    const tipTr = mk('span', 'tr', 'Wrong? Tell us');
    const tipBody = mk('span', 'tt');
    tipBody.appendChild(tipTx); tipBody.appendChild(tipTr);
    tipEl.appendChild(tipBg); tipEl.appendChild(tipIc); tipEl.appendChild(tipBody);
    let tipReport = null;
    wrap.appendChild(tipEl);

    const homeEl = home();
    if (homeEl) homeEl.appendChild(host);

    let total = null;
    let shown = null;
    let inflight = 0;
    let canEarn = true;
    let gateChip = COPY.linkChip;
    let steps = [];
    let lastSig = '';
    let blocked = null;
    let notice = null;
    let open = false;
    let panelDirty = true;
    let offOutside = null;
    const prefs = { sound: true, guide: true };
    const ver = { ver: '', available: false, required: false, latest: '', onTap: null, busy: false, amo: null };
    let dockPos = { left: INSET, top: INSET };
    let userPos = null;
    let drag = null;
    let relayoutT = null;
    let popped = null;
    let docked = null;
    let tipT = null;
    let pulseAnim = null, impactAnim = null, flashAnim = null, iconAnim = null, rollAnim = null, oldNumAnim = null, winAnim = null;
    let winGeneration = 0;
    const throttle = new Map();
    let lastTip = { text: '', at: -1e9 };

    const ptr = {
      spec: null, el: null, kind: '', shown: false, hasPos: false, everShown: false, x: 0, y: 0,
      hoverT: null, restT: null, settleT: null, suppressUntil: 0, lostFired: false, lastMove: 0,
      waitMs: 0, waitAt: null,
      io: null, offScroll: null, offScrollEnd: null, offResize: null, offTap: null,
    };
    const eye = {
      opts: null, state: null, mode: '', el: null, parts: null, hostEl: null, shadowHost: null, wrap: null,
      videoEl: null, ro: null, offScroll: null, offScrollEnd: null, offResize: null, raf: null,
      settleT: null, moving: false, lastMove: 0, w: 0,
      anchorLeft: null, anchorAt: 0, shownLeft: null, iv: null, doneT: null, offTap: null, doneFor: null, shift: 0,
      progressFor: null, progressMax: null,
    };

    function fmtNum(n) {
      try { return Math.round(n).toLocaleString('en-US'); } catch (_) { return String(Math.round(n)); }
    }
    function renderNum() {
      if (shown == null) { numEl.classList.add('unk'); return; }
      numEl.classList.remove('unk');
      const t = fmtNum(shown);
      if (numN.textContent !== t) { numN.textContent = t; numR.textContent = t; }
      try { pill.setAttribute('aria-label', t + ' tickets. Tap to see what this post pays.'); } catch (_) {   }
    }
    function setShown(n) { shown = n; renderNum(); }
    function bump(inc) {
      const previous = numN.textContent;
      if (shown == null) shown = 0;
      shown += inc;
      if (total != null && shown > total) shown = total;
      renderNum();
      if (!motionOK()) return;
      [pulseAnim, impactAnim, flashAnim, iconAnim, rollAnim, oldNumAnim].forEach((a) => { if (a) { try { a.cancel(); } catch (_) {   } } });
      numR.textContent = previous;
      rollAnim = anim(numN, [{ transform: 'translate(2px,24px)', opacity: 0 }, { transform: 'translate(-3px,-4px)', opacity: 1, offset: .5 }, { transform: 'translate(2px,2px)', opacity: 1, offset: .75 }, { transform: 'translate(0,0)', opacity: 1 }], { duration: 220 });
      oldNumAnim = anim(numR, [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-26px)', opacity: 0 }], { duration: 150 });
      pulseAnim = anim(pill, [{ transform: 'scale(1)' }, { transform: 'scale(1.18,.78) rotate(-2deg)', offset: .2 }, { transform: 'scale(.94,1.22) rotate(2deg)', offset: .48 }, { transform: 'scale(1.05,.94)', offset: .74 }, { transform: 'scale(1)' }], { duration: BUMP_MS });
      impactAnim = anim(impact, [{ transform: 'scale(.9)', opacity: 1 }, { transform: 'scale(1.28,1.5)', opacity: 0 }], { duration: 400 });
      flashAnim = anim(flash, [{ opacity: .95 }, { opacity: .3, offset: .45 }, { opacity: 0 }], { duration: BUMP_MS });
      iconAnim = anim(icImg, [{ transform: 'scale(1)' }, { transform: 'scale(1.35,.7) rotate(-12deg)' }, { transform: 'scale(.85,1.25) rotate(8deg)' }, { transform: 'scale(1)' }],
        { duration: SQUASH_MS });
      sparkleCounter();
    }
    function setTotal(n, o) {
      if (destroyed) return;
      const v = Math.round(Number(n));
      if (!Number.isFinite(v)) return;
      total = v;
      if (shown == null) { setShown(v); return; }
      if (inflight) return;
      if (o && o.animate && v > shown && motionOK()) { cashIn({ fromEl: 'hud', amount: v - shown, newTotal: v }); return; }
      setShown(v);
    }

    function renderChip() {
      const p = stepsProgress(steps);
      const complete = canEarn && p.total > 0 && p.done === p.total;
      pill.classList.toggle('complete', complete);
      progress.classList.toggle('off', !canEarn || !p.total);
      progressFill.style.transform = 'scaleX(' + (canEarn && p.total ? p.done / p.total : 0) + ')';
      if (canEarn === false) {
        chip.textContent = gateChip;
        chip.className = 'chip red';
        return;
      }
      chip.textContent = p.text;
      chip.className = p.total ? 'chip' + (complete ? ' complete' : '') : 'chip off';
      try { chip.setAttribute('aria-label', p.done + ' of ' + p.total + ' steps done'); } catch (_) {   }
    }
    function iconSrc(key) { return (key && IMG[key]) || IMG.ticket || ''; }
    function amountText(s) {
      if (s.pending) return '⋯';
      const a = s.amount;
      if (typeof a === 'number' && Number.isFinite(a)) return a > 0 ? '+' + Math.round(a) : '';
      return a == null ? '' : String(a);
    }
    function stepRow(s, idx) {
      const row = mk('div', 'step' + (s.done ? ' done' : '') + (s.voided ? ' voided' : '') + (s.pending ? ' pending' : ''));
      row.rgcIdx = idx;
      const si = mk('span', 'si');
      si.appendChild(img(s.done && !s.voided ? IMG.check : iconSrc(s.icon)));
      const tx = mk('span', 'tx');
      tx.appendChild(mk('span', 'lb', s.label == null ? '' : String(s.label)));
      if (s.done && !s.voided) tx.appendChild(mk('span', 'hn', doneText(s)));
      else if (s.hint) tx.appendChild(mk('span', 'hn', String(s.hint)));
      row.appendChild(si); row.appendChild(tx); row.appendChild(mk('span', 'amt', amountText(s)));
      return row;
    }
    on(list, 'click', (e) => {
      let row = null;
      for (let n = e && e.target, i = 0; n && n !== list && i < 8; n = n.parentNode, i++) {
        if (n.rgcIdx != null) { row = n; break; }
      }
      if (!row) return;
      try { e.stopPropagation(); } catch (_) {   }
      const cur = steps[row.rgcIdx];
      if (!cur) return;
      if (cur.done) { tip({ el: row, text: doneText(cur), icon: 'check' }); return; }
      if (coarse() || narrow()) setOpen(false);
      if (typeof cur.onTap === 'function') { try { cur.onTap(cur); } catch (_) {   } }
    });
    function renderPanel() {
      if (kick) return;
      panelDirty = false;
      list.replaceChildren();
      if (blocked) { list.appendChild(mk('div', 'warn', blocked)); return; }
      if (notice) list.appendChild(mk('div', 'warn', notice));
      steps.forEach((s, i) => { if (s) list.appendChild(stepRow(s, i)); });
    }
    function renderPrefs() {
      sndBtn.textContent = prefs.sound ? '🔊 Sound on' : '🔇 Sound off';
      gdBtn.textContent = prefs.guide ? 'Guide on' : 'Guide off';
    }
    function sizePanel() {
      const top = dockPos.top + COUNTER_H + GAP;
      panel.style.maxHeight = 'calc(100vh - ' + (top + 12) + 'px)';
      panel.style.maxHeight = 'calc(100dvh - ' + (top + 12) + 'px)';
      const pw = Math.min(300, viewW() - 16);
      const shift = Math.min(0, viewW() - 8 - dockPos.left - pw);
      panel.style.marginLeft = shift + 'px';
    }
    function setOpen(v) {
      v = !!v && !kick;
      if (v === open) return;
      if (v && docked) {
        let r = null;
        try { r = pill.getBoundingClientRect(); } catch (_) { r = null; }
        const back = { el: docked.el, o: docked.o };
        try { docked.shost.remove(); } catch (_) {   }
        docked = null;
        wrap.appendChild(dockEl);
        dockPos = { left: r ? Math.round(r.left) : INSET, top: r ? Math.round(r.top) : INSET };
        dockEl.style.left = dockPos.left + 'px';
        dockEl.style.top = dockPos.top + 'px';
        popped = back;
      }
      open = v;
      dockEl.classList.toggle('open', open);
      if (open) {
        if (panelDirty) renderPanel();
        sizePanel();
        offOutside = on(D, 'pointerdown', (e) => { if (!ownsEvent(e)) setOpen(false); }, true);
      } else {
        if (offOutside) { offOutside(); offOutside = null; }
        if (popped) { const b = popped; popped = null; dock(b.el, b.o); }
        else if (!docked) layout();
      }
    }
    function stepSig(list2) {
      try {
        return JSON.stringify(list2.map((s) => [s.id, s.icon, s.label, s.amount, !!s.done, !!s.voided, !!s.pending,
          s.hint || '', s.collected == null ? null : s.collected, s.count === false]));
      } catch (_) { return String(Math.random()); }
    }
    function setSteps(list2) {
      if (destroyed) return;
      const beforeSteps = steps.filter((s) => s.count !== false);
      const before = stepsProgress(steps);
      steps = Array.isArray(list2) ? list2.filter(Boolean) : [];
      const sig = stepSig(steps);
      if (sig === lastSig) return;
      lastSig = sig;
      renderChip();
      panelDirty = true;
      if (open) renderPanel();
      const after = stepsProgress(steps);
      const sameSet = before.total > 0 && before.done < before.total && after.total > 0
        && after.done === after.total && after.total === before.total
        && steps.filter((s) => s.count !== false).every((s, i) => s.id === beforeSteps[i].id);
      if (canEarn && !blocked && sameSet && motionOK()) {
        const earned = steps.reduce((n, s) => {
          if (s.count === false || !s.done || s.voided) return n;
          const paid = Number(s.collected != null ? s.collected : s.amount);
          return n + (Number.isFinite(paid) && paid > 0 ? Math.round(paid) : 0);
        }, 0);
        celebrateDone(earned);
      } else if (after.done < after.total) {
        hideWin();
      }
    }
    function setBlocked(m) {
      if (destroyed) return;
      const v = m ? String(m) : null;
      if (v === blocked) return;
      blocked = v; panelDirty = true; if (open) renderPanel(); refreshPointer();
    }
    function setNotice(m) {
      if (destroyed) return;
      const v = m ? String(m) : null;
      if (v === notice) return;
      notice = v; panelDirty = true; if (open) renderPanel();
    }
    function setCanEarn(v, o) {
      if (destroyed) return;
      canEarn = v !== false;
      gateChip = (o && o.chip) ? String(o.chip) : COPY.linkChip;
      renderChip();
      refreshPointer();
      if (eye.opts) watchPill(eye.opts);
    }

    on(pill, 'pointerdown', (e) => {
      if (kick || (e.button != null && e.button !== 0)) return;
      try { e.preventDefault(); } catch (_) {   }
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: dockPos.left, oy: dockPos.top, moved: false };
      try { pill.setPointerCapture(e.pointerId); } catch (_) {   }
    });
    on(pill, 'pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (docked) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      drag.moved = true;
      setDockPos(clampX(drag.ox + dx), clampY(drag.oy + dy));
    });
    function endDrag(e, tap) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const d = drag; drag = null;
      try { pill.releasePointerCapture(d.id); } catch (_) {   }
      if (d.moved && !docked) { userPos = { x: dockPos.left, y: dockPos.top }; savePos(); if (open) sizePanel(); }
      else if (tap) setOpen(!open);
    }
    on(pill, 'pointerup', (e) => endDrag(e, true));
    on(pill, 'pointercancel', (e) => endDrag(e, false));

    function guardFocus(btn) { on(btn, 'pointerdown', (e) => { try { e.preventDefault(); } catch (_) {   } }); }
    [sndBtn, gdBtn, verBtn, repBtn].forEach(guardFocus);
    let onReport = null;
    function setReport(fn) {
      onReport = typeof fn === 'function' ? fn : null;
      repBtn.className = onReport ? 'rep' : 'rep off';
    }
    on(repBtn, 'click', () => {
      try { repBtn.blur(); } catch (_) {   }
      if (!onReport) return;
      setOpen(false);
      try { onReport(); } catch (_) {   }
    });
    on(sndBtn, 'click', () => { setPref('sound', !prefs.sound); try { sndBtn.blur(); } catch (_) {   } });
    on(gdBtn, 'click', () => { setPref('guide', !prefs.guide); try { gdBtn.blur(); } catch (_) {   } });

    function renderVer() {
      if (ver.busy) return;
      if (ver.amo) return;
      if ((ver.available || ver.required) && ver.onTap) {
        verBtn.textContent = 'Update ⬆';
        verBtn.className = 'ver upd';
        verBtn.disabled = false;
        verBtn.title = ver.latest ? 'Install v' + ver.latest + ' now (you are on v' + ver.ver + ')' : 'Install the newest version now';
      } else {
        verBtn.textContent = ver.ver ? 'v' + ver.ver : '';
        verBtn.className = 'ver';
        verBtn.disabled = true;
        verBtn.title = '';
      }
    }
    function setVersion(info, onUpdateTap) {
      if (destroyed) return;
      info = info || {};
      const u = info.update || {};
      ver.ver = info.ver ? String(info.ver) : ver.ver;
      ver.available = !!u.available;
      ver.required = !!u.required;
      ver.latest = u.latest ? String(u.latest) : '';
      ver.onTap = typeof onUpdateTap === 'function' ? onUpdateTap : null;
      renderVer();
    }
    on(verBtn, 'click', () => {
      try { verBtn.blur(); } catch (_) {   }
      if (ver.amo) { try { W.open(ver.amo, '_blank', 'noopener'); } catch (_) {   } return; }
      if (verBtn.disabled || !ver.onTap || ver.busy) return;
      ver.busy = true;
      verBtn.disabled = true;
      verBtn.textContent = 'Updating…';
      let p;
      try { p = Promise.resolve(ver.onTap()); } catch (_) { p = Promise.resolve(null); }
      p.catch(() => null).then((r) => {
        if (destroyed) return;
        ver.busy = false;
        const st = r && r.status;
        if (st === 'unsupported') {
          ver.amo = (r && r.url) || AMO_URL;
          verBtn.textContent = 'Open add-ons site';
          verBtn.disabled = false;
          verBtn.title = 'Firefox installs updates from addons.mozilla.org';
          return;
        }
        if (st === 'update_available') { ver.busy = true; verBtn.textContent = 'Installing…'; return; }
        if (st === 'no_update') { ver.busy = true; verBtn.textContent = 'Already newest'; return; }
        if (st === 'throttled') {
          verBtn.textContent = 'Try again shortly';
          verBtn.disabled = false;
          verBtn.title = 'Chrome limits how often an extension may check. It will update on its own soon.';
          return;
        }
        verBtn.textContent = 'Update failed';
        verBtn.disabled = false;
        verBtn.title = 'Could not update from here. Open the extension icon and try Update now.';
      });
    });

    function pillRect() { try { return pill.getBoundingClientRect(); } catch (_) { return null; } }
    function pillW() { const r = pillRect(); return (r && r.width) || 120; }
    function clampX(x) { return Math.round(Math.max(0, Math.min(x, viewW() - pillW()))); }
    function clampY(y) { return Math.round(Math.max(0, Math.min(y, viewH() - COUNTER_H))); }
    function setDockPos(left, top) {
      const moved = !dockPos || dockPos.left !== left || dockPos.top !== top;
      dockPos = { left, top };
      if (docked) return;
      dockEl.style.left = left + 'px';
      dockEl.style.top = top + 'px';
      if (open) sizePanel();
      if (moved && eye && eye.el) deoverlapEye();
    }
    function probe(x, y, test) {
      if (typeof D.elementsFromPoint !== 'function') return null;
      const stack = D.elementsFromPoint(x, y) || [];
      for (let i = 0; i < stack.length && i < 25; i++) {
        const el = stack[i];
        if (isOwnNode(el)) continue;
        const cs = gcs(el);
        if (!cs || (cs.position !== 'fixed' && cs.position !== 'sticky')) continue;
        const r = el.getBoundingClientRect();
        if (test(r)) return r;
      }
      return null;
    }
    function measureChrome() {
      const vw = viewW(), vh = viewH();
      let top = 0, left = 0, found = false;
      [vw / 2, 24].forEach((x) => {
        const r = probe(x, 4, (b) => b.top <= 8 && b.height >= 24 && b.height <= 160 && b.width >= vw * 0.5);
        if (r) { top = Math.max(top, r.bottom); found = true; }
      });
      const r2 = probe(4, Math.min(vh - 10, top + 40), (b) => b.left <= 8 && b.width >= 40 && b.width <= 340 && b.height >= vh * 0.4);
      if (r2) { left = r2.right; found = true; }
      return found ? { top, left } : null;
    }
    function fallbackPos() {
      const f = FALLBACK[platform] || [0, 0, 0];
      return narrow() ? { top: f[2], left: 0 } : { top: f[0], left: f[1] };
    }
    function hitsControl(x, y) {
      if (typeof D.elementsFromPoint !== 'function') return false;
      const stack = D.elementsFromPoint(x, y) || [];
      for (let i = 0; i < stack.length && i < 25; i++) {
        const el = stack[i];
        if (isOwnNode(el)) continue;
        try { return !!(el.closest && el.closest(CTRL_SEL)); } catch (_) { return false; }
      }
      return false;
    }
    function pillPoints(l, top, w) {
      const xs = [l + 2, l + w * 0.25, l + w * 0.5, l + w * 0.75, l + w - 2];
      const ys = [top + 2, top + COUNTER_H / 2, top + COUNTER_H - 2];
      const pts = [];
      for (let a = 0; a < xs.length; a++) for (let b = 0; b < ys.length; b++) pts.push([xs[a], ys[b]]);
      return pts;
    }
    function collisionShift() {
      if (docked || userPos || fsEl() || docHidden()) return;
      const w = pillW();
      let top = dockPos.top;
      for (let i = 0; i < 30; i++) {
        const pts = pillPoints(dockPos.left, top, w);
        if (!pts.some((p) => hitsControl(p[0], p[1]))) break;
        top += 8;
        if (top > viewH() - COUNTER_H) { top = dockPos.top; break; }
      }
      if (top !== dockPos.top) setDockPos(dockPos.left, top);
    }
    function layout() {
      if (destroyed || docked) return;
      if (fsEl()) { setDockPos(INSET, INSET); return; }
      if (userPos) { setDockPos(clampX(userPos.x), clampY(userPos.y)); return; }
      let m = null;
      try { m = measureChrome(); } catch (_) { m = null; }
      const p = m || fallbackPos();
      setDockPos(Math.max(INSET, Math.round(p.left ? p.left + GAP : 0)), Math.max(INSET, Math.round(p.top ? p.top + GAP : 0)));
      collisionShift();
    }
    function scheduleRelayout() {
      relayoutT = cancel(relayoutT);
      relayoutT = later(() => { relayoutT = null; layout(); }, RELAYOUT_MS);
    }
    on(W, 'resize', scheduleRelayout, { passive: true });
    on(W, 'orientationchange', scheduleRelayout, { passive: true });

    function dock(el, o) {
      if (destroyed) return false;
      if (popped) { popped = el ? { el, o } : null; return true; }
      if (!el) {
        if (!docked) return true;
        try { docked.shost.remove(); } catch (_) {   }
        docked = null;
        wrap.appendChild(dockEl);
        dockEl.style.left = dockPos.left + 'px';
        dockEl.style.top = dockPos.top + 'px';
        layout();
        return true;
      }
      if (docked && docked.el === el) {
        if (docked.shost.parentNode !== el) { try { el.appendChild(docked.shost); } catch (_) { return false; } }
        return true;
      }
      if (docked) { try { docked.shost.remove(); } catch (_) {   } }
      const shost = mk('div');
      shost.id = DOCK_ID;
      shost.style.cssText = DOCK_HOST_CSS;
      if (o && o.outsideLeft) {
        shost.style.setProperty('left', 'auto', 'important');
        shost.style.setProperty('right', 'calc(100% + 12px)', 'important');
        shost.style.setProperty('top', INSET + 'px', 'important');
      } else if (o && Number.isFinite(o.top)) {
        shost.style.setProperty('top', Math.round(o.top) + 'px', 'important');
      }
      if (OWN) OWN.add(shost);
      const sroot = shost.attachShadow({ mode: 'open' });
      const w2 = mk('div', 'w solo' + (kick ? ' kick' : '') + (docHidden() ? ' pgh' : ''));
      sroot.appendChild(styleEl());
      sroot.appendChild(w2);
      stopBubble(w2);
      dockEl.style.left = ''; dockEl.style.top = '';
      w2.appendChild(dockEl);
      try { el.appendChild(shost); } catch (_) { return false; }
      docked = { el, shost, sroot, wrap: w2, o: o || null };
      setOpen(false);
      if (o && o.hideWhen) hideDockWhen(String(o.hideWhen));
      return true;
    }
    function hideDockWhen(sel) {
      try {
        let st = D.getElementById ? D.getElementById(DOCK_STYLE_ID) : null;
        if (!st) { st = mk('style'); st.id = DOCK_STYLE_ID; (D.head || D.documentElement).appendChild(st); }
        st.textContent = 'html:has(' + sel + ') #' + DOCK_ID + '{opacity:0!important;transition:opacity .15s}';
      } catch (_) {   }
    }

    function iconKeySrc(icon) { return icon && IMG[icon] ? IMG[icon] : ''; }
    function originPt() {
      try { const r = host.getBoundingClientRect(); return { left: r.left || 0, top: r.top || 0 }; } catch (_) { return { left: 0, top: 0 }; }
    }
    function resolveRect(el, rect) {
      if (rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
        const w = rect.width || 0, h = rect.height || 0;
        return { left: rect.left, top: rect.top, width: w, height: h, right: rect.left + w, bottom: rect.top + h };
      }
      let t = el;
      if (el === 'hud') t = pill;
      else if (el === 'eye') t = eye.el && !eye.el.classList.contains('gone') ? eye.el : null;
      if (!t || typeof t.getBoundingClientRect !== 'function') return null;
      try { const r = t.getBoundingClientRect(); return rectOk(r) ? r : null; } catch (_) { return null; }
    }
    function throttled(o) {
      const t = now();
      if (o.throttleKey) {
        const k = String(o.throttleKey), last = throttle.get(k);
        if (last != null && t - last < (o.throttleMs || THROTTLE_MS)) return true;
        throttle.set(k, t);
      }
      return false;
    }
    function hideTip() { tipT = cancel(tipT); tipEl.classList.remove('show'); }
    function tip(o) {
      if (destroyed || !o) return false;
      const text = o.text == null ? '' : String(o.text);
      if (!text) { hideTip(); return false; }
      if (throttled(o)) return false;
      const t = now();
      if (text === lastTip.text && t - lastTip.at < DEDUPE_MS && tipEl.classList.contains('show')) return true;
      const r = resolveRect(o.el, o.rect);
      if (!r) return false;
      lastTip = { text, at: t };
      tipTx.textContent = text;
      tipReport = typeof o.onReport === 'function' ? o.onReport : null;
      tipEl.classList.toggle('rep', !!tipReport);
      const src = iconKeySrc(o.icon);
      if (src) { tipIc.src = src; tipIc.className = 'ti'; } else tipIc.className = 'ti off';
      const org = originPt();
      const tw = Math.min(250, viewW() - 16);
      let th = 0;
      try { th = tipEl.offsetHeight || 0; } catch (_) { th = 0; }
      if (!th) th = 78;
      let x = r.left - org.left - 8;
      let y = r.top - org.top - th - 6;
      let below = false;
      if (r.top - th - 6 < 6) { y = r.bottom - org.top + 6; below = true; }
      if (x + tw > viewW() - 6 - org.left) x = viewW() - 6 - org.left - tw;
      x = Math.max(6 - org.left, x);
      tipEl.classList.toggle('below', below);
      tipEl.style.left = Math.round(x) + 'px';
      tipEl.style.top = Math.round(y) + 'px';
      tipEl.classList.add('show');
      tipT = cancel(tipT);
      tipT = later(hideTip, o.ms > 0 ? o.ms : TIP_MS);
      return true;
    }
    on(tipEl, 'click', hideTip);
    on(tipTr, 'click', (e) => {
      try { e.stopPropagation(); } catch (_) {   }
      const fn = tipReport;
      hideTip();
      if (fn) { try { fn(); } catch (_) {   } }
    });

    function reject(o) {
      if (destroyed || !o) return false;
      if (throttled(o)) return false;
      const r = resolveRect(o.el, o.rect);
      if (r && !docHidden()) {
        const org = originPt();
        const x = Math.max(6 - org.left, r.left - org.left - 112), y = r.top - org.top - 6;
        const t = mk('div', 'rej');
        t.appendChild(img(IMG.reject));
        fxLayer.appendChild(t);
        const kf = reduced
          ? [{ transform: 'translate(' + x + 'px,' + y + 'px)', opacity: 0 }, { transform: 'translate(' + x + 'px,' + y + 'px)', opacity: 1, offset: 0.2 },
            { transform: 'translate(' + x + 'px,' + y + 'px)', opacity: 1, offset: 0.7 }, { transform: 'translate(' + x + 'px,' + y + 'px)', opacity: 0 }]
          : [{ transform: 'translate(' + x + 'px,' + (y + 20) + 'px) scale(.5)', opacity: 0 },
            { transform: 'translate(' + x + 'px,' + y + 'px) scale(1)', opacity: 1, offset: 0.2 },
            { transform: 'translate(' + (x - 6) + 'px,' + y + 'px) rotate(-4deg)', offset: 0.3 },
            { transform: 'translate(' + (x + 6) + 'px,' + y + 'px) rotate(4deg)', offset: 0.4 },
            { transform: 'translate(' + x + 'px,' + y + 'px)', opacity: 1, offset: 0.5 },
            { transform: 'translate(' + x + 'px,' + (y + 24) + 'px)', opacity: 0 }];
        const a = anim(t, kf, { duration: REJECT_MS, fill: 'forwards' }, () => { try { t.remove(); } catch (_) {   } });
        if (!a) { try { t.remove(); } catch (_) {   } }
      }
      return tip({ el: o.el, rect: o.rect, text: o.text, icon: o.icon, ms: o.ms || (o.onReport ? 6000 : 0), onReport: o.onReport });
    }

    function effect(cls, src, kf, options, done) {
      const el = mk('div', cls);
      if (src) el.appendChild(img(src));
      fxLayer.appendChild(el);
      anim(el, kf, options, (ok) => {
        try { el.remove(); } catch (_) {   }
        if (done) done(ok);
      });
      return el;
    }
    function effectPoint(x, y, margin) {
      const org = originPt(), m = margin || 12;
      return {
        x: Math.max(m - org.left, Math.min(viewW() - org.left - m, x)),
        y: Math.max(m - org.top, Math.min(viewH() - org.top - m, y)),
      };
    }
    function sparkleCounter() {
      if (!motionOK()) return;
      const r = pillRect();
      if (!rectOk(r)) return;
      const org = originPt();
      for (let i = 0; i < 3; i++) {
        const x = r.left - org.left + r.width * (.2 + i * .32), y = r.top - org.top + r.height / 2;
        const end = effectPoint(x + (i - 1) * 36, y + (i % 2 ? 46 : -42));
        effect('confetti', IMG.confettiGold, [
          { transform: tf(x, y) + ' scale(.2)', opacity: 0 },
          { transform: tf(x, y - 12) + ' scale(1.1)', opacity: 1, offset: .2 },
          { transform: tf(end.x, end.y) + ' scale(.3) rotate(140deg)', opacity: 0 },
        ], { duration: 450, delay: i * 25 });
      }
    }
    function flyLabel(x, y, hx, hy, n) {
      const strength = Math.min(4, Math.log2(n + 1));
      const l = mk('div', 'lbl');
      const hype = ['Nice!', 'Boom!', "Let's go!", 'Cha-ching!'];
      l.appendChild(mk('span', 'hype', hype[Math.floor(Math.random() * hype.length)]));
      const number = mk('b', null, '+' + fmtNum(n));
      number.style.fontSize = Math.max(42, 64 + strength * 8 - Math.max(0, String(n).length - 3) * 10) + 'px';
      number.style.lineHeight = '1.05';
      l.appendChild(number); l.appendChild(mk('span', null, 'TICKETS!'));
      const width = Math.min(240 + strength * 24, viewW() - 64);
      l.style.width = width + 'px';
      fxLayer.appendChild(l);
      const height = l.offsetHeight || 170;
      const org = originPt();
      const cx = Math.max(width / 2 + 32 - org.left, Math.min(x, viewW() - org.left - width / 2 - 32));
      const cy = Math.max(height / 2 + 40 - org.top, Math.min(y + (y + org.top < viewH() * .32 ? 152 : -130), viewH() - org.top - height / 2 - 32));
      const lx = cx - width / 2, ly = cy - height / 2;
      const end = tf(hx - width / 2, hy - height / 2);
      anim(l, [
        { transform: tf(lx, ly + 30) + ' scale(.15) rotate(-14deg)', opacity: 0 },
        { transform: tf(lx, ly) + ' scale(1.17,.94) rotate(5deg)', opacity: 1, offset: .13 },
        { transform: tf(lx, ly) + ' scale(.94,1.06) rotate(-4deg)', opacity: 1, offset: .23 },
        { transform: tf(lx, ly) + ' scale(1.04) rotate(2deg)', opacity: 1, offset: .34 },
        { transform: tf(lx, ly) + ' scale(1) rotate(-1deg)', opacity: 1, offset: .5 },
        { transform: tf(lx, ly - 4) + ' scale(1.03) rotate(1deg)', opacity: 1, offset: .67 },
        { transform: tf((lx + hx - width / 2) / 2 + 65, Math.min(ly, hy) - 30) + ' scale(.65) rotate(-9deg)', opacity: 1, offset: .83 },
        { transform: end + ' scale(.08) rotate(12deg)', opacity: .9, offset: .97 },
        { transform: end + ' scale(.02)', opacity: 0 },
      ], { duration: LABEL_MS, easing: 'ease-out' }, () => { try { l.remove(); } catch (_) {   } });
      const glowScale = Math.min(1.35, (width + 100) / 360);
      effect('burst', IMG.burstGlow, [
        { transform: tf(cx - 180, cy - 180) + ' scale(.1)', opacity: 0 },
        { transform: tf(cx - 180, cy - 180) + ' scale(' + glowScale * 1.2 + ') rotate(12deg)', opacity: 1, offset: .2 },
        { transform: tf(cx - 180, cy - 180) + ' scale(' + glowScale + ') rotate(-4deg)', opacity: .85, offset: .7 },
        { transform: tf(cx - 180, cy - 180) + ' scale(1.6) rotate(25deg)', opacity: 0 },
      ], { duration: 1650 });
      return { x: cx, y: cy };
    }
    function streamFrames(x, y, hx, hy, i, count, spread, width, ticket) {
      const angle = i * Math.PI * 2 / count + (ticket ? .35 : 0);
      const radius = spread * (.65 + (i % 4) * .12);
      const p = effectPoint(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * .78, width / 2 + 8);
      const finish = { x: hx - width / 2, y: hy - (ticket ? width * .28 : width / 2) };
      const scatter = { x: p.x - width / 2, y: p.y - (ticket ? width * .28 : width / 2) };
      const control = effectPoint((scatter.x + finish.x) / 2 + (i % 2 ? 155 : -85), Math.min(scatter.y, finish.y) - 160, 12);
      const kf = [
        { transform: tf(x - width / 2, y - width / 2) + ' scale(.1) rotate(' + i * 23 + 'deg)', opacity: 0 },
        { transform: tf(scatter.x, scatter.y) + ' scale(1.12) rotate(' + i * 43 + 'deg)', opacity: 1, offset: .15 },
        { transform: tf(scatter.x + Math.cos(angle) * 18, scatter.y + 26) + ' scale(1) rotate(' + (i * 43 + 60) + 'deg)', opacity: 1, offset: .48 },
      ];
      const start = { x: scatter.x + Math.cos(angle) * 18, y: scatter.y + 26 };
      for (let j = 1; j <= 4; j++) {
        const t = j / 4, u = 1 - t;
        kf.push({
          transform: tf(u * u * start.x + 2 * u * t * control.x + t * t * finish.x,
            u * u * start.y + 2 * u * t * control.y + t * t * finish.y)
            + ' scale(' + (1 - t * .72) + ') rotate(' + (i * 43 + 60 + t * 240) + 'deg)',
          opacity: 1, offset: .48 + t * .5,
        });
      }
      kf.push({ transform: tf(finish.x, finish.y) + ' scale(.1)', opacity: 0 });
      return kf;
    }
    function burstBits(x, y, hx, hy, amount) {
      const strength = Math.min(4, Math.log2(amount + 1));
      const count = Math.min(64, 32 + Math.ceil(strength * 8));
      const colors = [IMG.confettiGold, IMG.confettiJade, IMG.confettiPink, IMG.confettiCyan];
      for (let i = 0; i < count; i++) {
        const width = 16 + (i % 3) * 5;
        const bit = effect('confetti', colors[i % colors.length],
          streamFrames(x, y, hx, hy, i, count, 145 + strength * 25, width, false),
          { duration: 2120 + (i % 5) * 90, delay: (i % 6) * 22, easing: FLY_EASE });
        bit.style.width = width + 'px'; bit.style.height = width + 'px';
      }
    }
    function hideWin() {
      winGeneration++;
      const a = winAnim; winAnim = null;
      if (a) { try { a.cancel(); } catch (_) {   } }
      win.classList.remove('show');
      try { win.remove(); } catch (_) {   }
    }
    function celebrateDone(earned) {
      hideWin();
      if (!motionOK()) return;
      const generation = winGeneration;
      winAmount.textContent = earned > 0 ? '+' + fmtNum(earned) + ' tickets earned on this post' : 'Every step complete';
      fxLayer.appendChild(win); win.classList.add('show');
      const org = originPt();
      const x = (viewW() - (win.offsetWidth || 440)) / 2 - org.left, y = 82 - org.top;
      win.style.left = x + 'px'; win.style.top = y + 'px';
      winAnim = anim(win, [
        { transform: 'translateY(-160px) scale(.45)', opacity: 0 },
        { transform: 'translateY(16px) scale(1.1,.94) rotate(3deg)', opacity: 1, offset: .17 },
        { transform: 'translateY(-8px) scale(.98,1.04) rotate(-2deg)', opacity: 1, offset: .27 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: .4 },
        { transform: 'translateY(0) scale(1)', opacity: 1, offset: .82 },
        { transform: 'translateY(-36px) scale(.1)', opacity: 0 },
      ], { duration: 2500, easing: 'ease-out' }, () => {
        if (generation !== winGeneration) return;
        winAnim = null; win.classList.remove('show');
        try { win.remove(); } catch (_) {   }
      });
      const colors = [IMG.confettiGold, IMG.confettiJade, IMG.confettiPink, IMG.confettiCyan];
      for (let i = 0; i < 3; i++) {
        const cx = viewW() * (.18 + i * .32) - org.left, cy = 95 - org.top;
        effect('burst', IMG.firework || IMG.burstGlow, [
          { transform: tf(cx - 180, cy - 180) + ' scale(.05)', opacity: 0 },
          { transform: tf(cx - 180, cy - 180) + ' scale(.9) rotate(15deg)', opacity: 1, offset: .25 },
          { transform: tf(cx - 180, cy - 180) + ' scale(1.35) rotate(40deg)', opacity: 0 },
        ], { duration: 1050, delay: i * 210 });
      }
      for (let i = 0; i < 72; i++) {
        const sx = viewW() * ((i % 3) * .32 + .18) - org.left, sy = 90 - org.top;
        const angle = i * 2.39996;
        const ex = Math.max(12, Math.min(viewW() - 24, sx + org.left + Math.cos(angle) * (120 + i % 6 * 35))) - org.left;
        const apex = sy - 50 - (i % 5) * 18;
        effect('confetti', colors[i % colors.length], [
          { transform: tf(sx, sy) + ' scale(.1)', opacity: 0 },
          { transform: tf(ex, apex) + ' scale(1.3) rotate(' + i * 37 + 'deg)', opacity: 1, offset: .25 },
          { transform: tf(ex + Math.sin(angle) * 45, Math.min(viewH() - 20 - org.top, sy + 170 + (i % 5) * 54)) + ' rotate(' + (i * 37 + 330) + 'deg)', opacity: .9, offset: .85 },
          { transform: tf(ex, Math.min(viewH() - 10 - org.top, sy + 320 + (i % 4) * 35)) + ' scale(.5) rotate(' + (i * 37 + 400) + 'deg)', opacity: 0 },
        ], { duration: 1850 + (i % 5) * 70, delay: (i % 3) * 190, easing: 'ease-out' });
      }
    }
    function cashIn(o) {
      if (destroyed || !o) return Promise.resolve(false);
      const amount = Math.max(0, Math.round(Number(o.amount) || 0));
      const nt = Number(o.newTotal);
      const hasNt = o.newTotal != null && Number.isFinite(nt);
      if (hasNt) total = Math.round(nt);
      else if (amount) total = (total != null ? total : (shown || 0)) + amount;
      if (shown == null) shown = total != null ? total - amount : 0;
      if (amount <= 0) { if (!inflight && total != null) setShown(total); return Promise.resolve(false); }
      const from = o.fromRect ? resolveRect(null, o.fromRect) : resolveRect(o.fromEl, null);
      const to = (() => { try { const r = icImg.getBoundingClientRect(); return rectOk(r) ? r : pillRect(); } catch (_) { return null; } })();
      const canFly = motionOK() && rectOk(from) && rectOk(to) && typeof fxLayer.animate === 'function';
      if (!canFly) {
        playCoin();
        if (!inflight) setShown(total);
        return Promise.resolve(true);
      }
      inflight++;
      playCoin();
      const org = originPt();
      const selfBurst = o.fromEl === 'hud';
      const bx = from.left + from.width / 2 - org.left;
      const by = (selfBurst ? from.bottom + 36 : from.top) - org.top;
      const hx = to.left + to.width / 2 - org.left, hy = to.top + to.height / 2 - org.top;
      const pop = flyLabel(bx, by, hx, hy, amount);
      burstBits(pop.x, pop.y, hx, hy, amount);
      const plan = burstPlan(amount);
      const strength = Math.min(4, Math.log2(amount + 1));
      const count = Math.min(28, 12 + Math.ceil(strength * 4));
      let landed = 0;
      return new Promise((resolve) => {
        const colors = [IMG.ticket, IMG.ticketJade || IMG.ticket, IMG.ticketViolet || IMG.ticket, IMG.ticketCyan || IMG.ticket];
        for (let i = 0; i < count; i++) {
          const inc = i < plan.length ? plan[i] : 0;
          const land = (ok) => {
            if (ok && !destroyed) bump(inc);
            if (++landed === count) {
              inflight = Math.max(0, inflight - 1);
              if (!inflight && !destroyed && total != null && shown !== total) setShown(total);
              resolve(true);
            }
          };
          effect('fx', colors[i % colors.length],
            streamFrames(pop.x, pop.y, hx, hy, i, count, 135 + strength * 22, FLY_W, true),
            { duration: FLY_MS + Math.floor(i / 6) * 60, delay: (i % 6) * FLY_GAP_MS, easing: FLY_EASE }, land);
        }
      });
    }

    const snd = { ctx: null, buf: null, decoding: false, armed: false, unlocked: false, playing: 0, offs: [] };
    const AC = () => W.AudioContext || W.webkitAudioContext || null;
    function armAudio() {
      if (snd.armed || snd.unlocked || destroyed || !prefs.sound || !AC() || !A.coinMp3) return;
      snd.armed = true;
      const o = { capture: true, passive: true };
      snd.offs = [on(W, 'pointerdown', gesture, o), on(W, 'touchend', gesture, o), on(W, 'keydown', gesture, o)];
    }
    function disarmAudio() { snd.offs.forEach((f) => f()); snd.offs = []; snd.armed = false; }
    function gesture(e) {
      if (destroyed || (e && e.isTrusted === false) || !prefs.sound) return;
      const C = AC();
      if (!C) return;
      try { if (!snd.ctx) snd.ctx = new C(); } catch (_) { disarmAudio(); return; }
      decode();
      let p = null;
      try { p = snd.ctx.resume ? snd.ctx.resume() : null; } catch (_) { p = null; }
      const settle = () => {
        if (destroyed || !snd.ctx) return;
        if (snd.ctx.state === 'running') { snd.unlocked = true; disarmAudio(); if (!snd.playing) suspendAudio(); }
      };
      if (p && typeof p.then === 'function') p.then(settle, () => {}); else settle();
    }
    function decode() {
      if (snd.buf || snd.decoding || !snd.ctx || typeof atob !== 'function') return;
      snd.decoding = true;
      let ab;
      try {
        const bin = atob(A.coinMp3);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        ab = u8.buffer;
      } catch (_) { snd.decoding = false; return; }
      const ok = (b) => { if (b) snd.buf = b; snd.decoding = false; };
      const bad = () => { snd.decoding = false; };
      try {
        const p = snd.ctx.decodeAudioData(ab, ok, bad);
        if (p && typeof p.then === 'function') p.then(ok, bad);
      } catch (_) { bad(); }
    }
    function suspendAudio() {
      try { if (snd.ctx && snd.ctx.state === 'running' && snd.ctx.suspend) { const p = snd.ctx.suspend(); if (p && p.catch) p.catch(() => {}); } } catch (_) {   }
    }
    function playCoin() {
      if (!prefs.sound || docHidden() || !snd.ctx || !snd.buf) return false;
      const ctx = snd.ctx;
      const go = () => {
        if (destroyed) return;
        if (ctx.state !== 'running') { relock(); return; }
        try {
          const src = ctx.createBufferSource();
          src.buffer = snd.buf;
          let out = ctx.destination;
          if (ctx.createGain) { const g = ctx.createGain(); g.gain.value = 0.8; g.connect(ctx.destination); out = g; }
          src.connect(out);
          snd.playing++;
          src.onended = () => { snd.playing = Math.max(0, snd.playing - 1); if (!snd.playing) suspendAudio(); };
          src.start(0);
        } catch (_) {   }
      };
      if (ctx.state === 'running') { go(); return true; }
      let p = null;
      try { p = ctx.resume ? ctx.resume() : null; } catch (_) { p = null; }
      if (p && typeof p.then === 'function') p.then(go, relock); else go();
      return true;
    }
    function relock() { snd.unlocked = false; armAudio(); }

    function pointerAllowed() {
      if (kick || !prefs.guide || canEarn === false || blocked) return false;
      const fs = fsEl();
      if (fs && (coarse() || String(fs.tagName || '').toUpperCase() === 'VIDEO')) return false;
      return true;
    }
    function stopWaitClock() {
      if (ptr.waitAt != null) { ptr.waitMs += Math.max(0, now() - ptr.waitAt); ptr.waitAt = null; }
    }
    function hideGuide(forget) {
      stopWaitClock();
      guide.classList.add('hide');
      guide.classList.remove('hover');
      ptr.shown = false;
      ptr.hoverT = cancel(ptr.hoverT);
      ptr.restT = cancel(ptr.restT);
      if (forget) ptr.hasPos = false;
    }
    function fireLost(reason) {
      if (ptr.lostFired || !ptr.spec || typeof ptr.spec.onLost !== 'function') return;
      ptr.lostFired = true;
      try { ptr.spec.onLost(reason); } catch (_) {   }
    }
    function unwatchTarget() {
      if (ptr.io) { try { ptr.io.disconnect(); } catch (_) {   } ptr.io = null; }
      ['offScroll', 'offScrollEnd', 'offResize', 'offTap'].forEach((k) => { if (ptr[k]) { ptr[k](); ptr[k] = null; } });
      ptr.settleT = cancel(ptr.settleT);
    }
    function settle() { ptr.settleT = cancel(ptr.settleT); placePointer(false); }
    function onMove() {
      ptr.lastMove = now();
      if (ptr.shown) hideGuide(true);
      ptr.settleT = cancel(ptr.settleT);
      ptr.settleT = later(settle, SETTLE_MS);
    }
    function onScrollEnd() {
      if (ptr.settleT && now() - (ptr.lastMove || 0) >= SETTLE_MS - 50) settle();
    }
    function watchTarget() {
      const el = ptr.el;
      ptr.offScroll = on(W, 'scroll', onMove, { capture: true, passive: true });
      if ('onscrollend' in W) ptr.offScrollEnd = on(W, 'scrollend', onScrollEnd, { capture: true, passive: true });
      ptr.offResize = on(W, 'resize', onMove, { passive: true });
      ptr.offTap = on(el, 'pointerdown', () => {
        ptr.suppressUntil = now() + TAP_HIDE_MS; hideGuide(false);
        const fn = ptr.spec && ptr.spec.onTap;
        if (typeof fn === 'function') { try { fn(); } catch (_) {   } }
      }, { passive: true });
      if (typeof IntersectionObserver === 'function') {
        try {
          ptr.io = new IntersectionObserver((entries) => {
            const e = entries && entries[entries.length - 1];
            if (!e || destroyed) return;
            if (!e.isIntersecting) { if (ptr.shown) hideGuide(true); } else if (!ptr.shown && !ptr.settleT) placePointer(false);
          });
          ptr.io.observe(el);
        } catch (_) { ptr.io = null; }
      }
    }
    function tf(x, y) { return 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; }
    function placePointer(fresh, chk) {
      if (destroyed || !ptr.el || !ptr.spec || kick) return false;
      if (!pointerAllowed()) { hideGuide(false); return true; }
      if (now() < ptr.suppressUntil) return true;
      if (!chk) chk = canPoint(ptr.el, ptr.spec.hitScope, ptr.spec.allowFaded);
      if (!chk.ok) { hideGuide(false); if (!fresh) fireLost(chk.reason); return false; }
      ptr.lostFired = false;
      const org = originPt(), r = chk.rect, vw = viewW();
      const x = r.left + Math.min(r.width * 0.45, 60) - org.left;
      const y = r.top + r.height * 0.55 - org.top;
      const kind = KINDS[ptr.spec.kind] ? ptr.spec.kind : 'tix';
      const amt = Math.round(Number(ptr.spec.amount) || 0);
      const amtText = amt > 0 ? '+' + amt : '';
      if (!fresh && ptr.shown && ptr.kind === kind && Math.abs(x - ptr.x) < 2 && Math.abs(y - ptr.y) < 2) {
        if (hovN.textContent !== amtText) hovN.textContent = amtText;
        return true;
      }
      let from = null;
      if (ptr.hasPos) from = { x: ptr.x, y: ptr.y };
      else if (!ptr.shown && !ptr.everShown) {
        const pr = pillRect();
        if (rectOk(pr)) from = { x: pr.left + pr.width / 2 - org.left, y: pr.top + pr.height / 2 - org.top };
      }
      if (hovN.textContent !== amtText) hovN.textContent = amtText;
      stopWaitClock();
      const rested = ptr.waitMs >= REST_MS;
      guide.className = 'guide k-' + kind + (y + org.top < 145 ? ' below' : '') + (x + org.left > vw - 180 ? ' flipx' : '')
        + (rested ? ' hover rest' : '');
      rip.style.left = (r.left - org.left - x - 12) + 'px';
      rip.style.top = (r.top - org.top - y - 12) + 'px';
      rip.style.width = (r.width + 24) + 'px'; rip.style.height = (r.height + 24) + 'px';
      const to = tf(x, y);
      if (from && motionOK() && (Math.abs(from.x - x) > 1 || Math.abs(from.y - y) > 1)) {
        anim(guide, [{ transform: tf(from.x, from.y) }, { transform: to }], { duration: GLIDE_MS, easing: GLIDE_EASE });
      }
      guide.style.transform = to;
      ptr.x = x; ptr.y = y; ptr.kind = kind; ptr.shown = true; ptr.hasPos = true; ptr.everShown = true;
      ptr.hoverT = cancel(ptr.hoverT);
      ptr.restT = cancel(ptr.restT);
      const spec = ptr.spec;
      const showTip = () => {
        if (spec.tip && spec.tip.text && ptr.el === spec.el) tip({ el: ptr.el, text: spec.tip.text, icon: spec.tip.icon });
      };
      if (rested) {
        if (fresh) showTip();
        return true;
      }
      ptr.waitAt = now();
      ptr.hoverT = later(() => {
        ptr.hoverT = null;
        guide.classList.add('hover');
        showTip();
      }, reduced ? 0 : HOVER_MS);
      if (Number.isFinite(REST_MS)) {
        ptr.restT = later(() => { ptr.restT = null; stopWaitClock(); ptr.waitMs = REST_MS; guide.classList.add('rest'); },
          Math.max(0, REST_MS - ptr.waitMs));
      }
      return true;
    }
    function pointTo(spec) {
      if (destroyed) return false;
      if (!spec) { hideGuide(false); unwatchTarget(); ptr.spec = null; ptr.el = null; ptr.waitMs = 0; return true; }
      if (!spec.el) { pointTo(null); return false; }
      const same = ptr.el === spec.el && ptr.spec && ptr.spec.kind === spec.kind;
      if (same) {
        ptr.spec = spec;
        if (spec.tip && spec.tip.text) { ptr.waitAt = null; ptr.waitMs = 0; ptr.suppressUntil = 0; return placePointer(true); }
        return placePointer(false);
      }
      let chk = null;
      if (pointerAllowed()) {
        chk = canPoint(spec.el, spec.hitScope, spec.allowFaded);
        if (!chk.ok) return false;
      }
      hideGuide(false);
      unwatchTarget();
      ptr.spec = spec;
      ptr.el = spec.el;
      ptr.lostFired = false;
      ptr.suppressUntil = 0;
      ptr.waitMs = 0;
      watchTarget();
      return placePointer(true, chk);
    }
    function refreshPointer() {
      if (!ptr.spec) return;
      if (pointerAllowed()) placePointer(false); else hideGuide(false);
    }

    function buildEye() {
      const p = mk('div', 'epill off');
      const box = mk('span', 'eye');
      const o = img(IMG.eyeOpen, 'o'), c = img(IMG.eyeClosed, 'c'), wt = img(IMG.wait, 'wt'), tk = img(IMG.ticket, 'tt2');
      box.appendChild(o); box.appendChild(c); box.appendChild(wt); box.appendChild(tk);
      const lft = mk('span', 'lft');
      const why = mk('span', 'why');
      const reward = mk('span', 'reward');
      const meter = mk('span', 'meter');
      const fill = mk('span', 'fill'); meter.appendChild(fill);
      p.appendChild(box); p.appendChild(lft); p.appendChild(why); p.appendChild(reward); p.appendChild(meter);
      eye.parts = { box, lft, why, reward, fill };
      eye.offTap = on(p, 'click', (e) => {
        try { e.stopPropagation(); } catch (_) {   }
        if (!eye.opts || !eye.opts.tappable) return;
        const st = eye.state;
        const text = st === 'ad' ? COPY.ad : st === 'gate' ? COPY.link
          : (eye.opts.tipText || watchTipText(eye.opts.amount, eye.shownLeft));
        tip({ el: p, text, icon: st === 'ad' ? 'wait' : st === 'gate' ? 'link' : 'eyeOpen' });
      });
      return p;
    }
    function removeEyeDom() {
      eye.iv = stopEvery(eye.iv);
      eye.doneT = cancel(eye.doneT);
      if (eye.ro) { try { eye.ro.disconnect(); } catch (_) {   } eye.ro = null; }
      ['offScroll', 'offScrollEnd', 'offResize', 'offTap'].forEach((k) => { if (eye[k]) { eye[k](); eye[k] = null; } });
      if (eye.raf) { eye.raf(); eye.raf = null; }
      eye.settleT = cancel(eye.settleT); eye.moving = false;
      if (eye.shadowHost) { try { eye.shadowHost.remove(); } catch (_) {   } }
      if (eye.el) { try { eye.el.remove(); } catch (_) {   } }
      eye.el = null; eye.parts = null; eye.shadowHost = null; eye.wrap = null; eye.hostEl = null; eye.videoEl = null; eye.mode = '';
      eye.shift = 0;
    }
    function removeEye() {
      removeEyeDom();
      eye.opts = null; eye.state = null; eye.shownLeft = null; eye.anchorLeft = null;
      eye.progressFor = null; eye.progressMax = null;
    }
    function mountEyeInHost(hostEl) {
      if (eye.mode === 'host' && eye.hostEl === hostEl && eye.shadowHost) {
        if (eye.shadowHost.parentNode !== hostEl) { try { hostEl.appendChild(eye.shadowHost); } catch (_) {   } }
        return;
      }
      removeEyeDom();
      const sh = mk('div');
      sh.id = EYE_ID;
      sh.style.cssText = EYE_HOST_CSS;
      if (OWN) OWN.add(sh);
      const sr = sh.attachShadow({ mode: 'open' });
      const w2 = mk('div', 'w solo' + (docHidden() ? ' pgh' : ''));
      sr.appendChild(styleEl());
      sr.appendChild(w2);
      stopBubble(w2);
      eye.el = buildEye();
      w2.appendChild(eye.el);
      try { hostEl.appendChild(sh); } catch (_) {   }
      eye.mode = 'host'; eye.hostEl = hostEl; eye.shadowHost = sh; eye.wrap = w2; eye.fresh = true;
    }
    function positionEyeFixed() {
      if (!eye.el || eye.mode !== 'fixed') return;
      const v = eye.videoEl;
      let r = null;
      try { r = v && v.isConnected !== false && v.getBoundingClientRect ? v.getBoundingClientRect() : null; } catch (_) { r = null; }
      const vw = viewW(), vh = viewH();
      const ok = r && r.width >= 120 && r.height >= 68 && r.bottom > 0 && r.right > 0 && r.left < vw && r.top < vh;
      if (!ok) { eye.el.classList.add('gone'); return; }
      const org = originPt();
      const P = docked ? null : pillRect();
      let ew = 0;
      if (!eye.el.classList.contains('gone')) { try { ew = eye.el.offsetWidth || 0; } catch (_) { ew = 0; } }
      if (ew) eye.w = ew; else ew = eye.w || 0;
      const right = Math.round(r.right - org.left - INSET);
      const top0 = Math.round(Math.max(r.top, 0) - org.top + INSET);
      let need = eye.shift;
      if (docked) need = 0;
      else if (ew && rectOk(P)) need = overlapShift({ left: right + org.left - ew, right: right + org.left, top: top0 + org.top, height: PILL_H }, P);
      if (eye.state !== 'done' || !eye.doneT) eye.el.classList.remove('gone');
      eye.shift = need;
      eye.el.style.left = right + 'px';
      eye.el.style.top = (top0 + need) + 'px';
    }
    function overlapShift(E, P) {
      const hit = E.left < P.right + 4 && E.right > P.left - 4 && E.top < P.bottom + 4 && E.top + E.height > P.top - 4;
      return hit ? Math.ceil(P.bottom + 6 - E.top) : 0;
    }
    function deoverlapEye() {
      if (!eye.el || docked || eye.el.classList.contains('gone')) return;
      let P = null, E = null;
      try { P = pillRect(); E = eye.el.getBoundingClientRect(); } catch (_) { return; }
      if (!rectOk(P) || !rectOk(E)) return;
      if (E.width) eye.w = E.width;
      const top0 = E.top - eye.shift;
      const need = overlapShift({ left: E.left, right: E.right, top: top0, height: E.height }, P);
      if (need === eye.shift) return;
      eye.shift = need;
      if (eye.mode === 'host' && eye.shadowHost) {
        try { eye.shadowHost.style.setProperty('top', (INSET + need) + 'px', 'important'); } catch (_) {   }
      } else if (eye.mode === 'fixed') {
        eye.el.style.top = Math.round(top0 - originPt().top + need) + 'px';
      }
    }
    function scheduleEyePos() {
      if (eye.raf) return;
      eye.raf = oneFrame(() => { eye.raf = null; positionEyeFixed(); });
    }
    function eyeScrollMoves(e) {
      const t = e && e.target;
      if (!t || t === W || t === D || t === D.documentElement || t === D.body) return true;
      const v = eye.videoEl;
      try { return !v || typeof t.contains !== 'function' || t.contains(v); } catch (_) { return true; }
    }
    function onEyeMove(e) {
      if (!eye.el || eye.mode !== 'fixed' || !eyeScrollMoves(e)) return;
      eye.lastMove = now();
      if (!eye.moving) { eye.moving = true; eye.el.classList.add('mv'); }
      eye.settleT = cancel(eye.settleT);
      eye.settleT = later(settleEye, SETTLE_MS);
    }
    function onEyeScrollEnd() {
      if (eye.settleT && now() - (eye.lastMove || 0) >= SETTLE_MS - 50) settleEye();
    }
    function settleEye() {
      eye.settleT = cancel(eye.settleT);
      positionEyeFixed();
      if (eye.moving && eye.el) eye.el.classList.remove('mv');
      eye.moving = false;
    }
    function mountEyeFixed(videoEl) {
      if (eye.mode !== 'fixed' || !eye.el) {
        removeEyeDom();
        eye.el = buildEye();
        wrap.appendChild(eye.el);
        eye.mode = 'fixed';
        eye.fresh = true;
        eye.offScroll = on(W, 'scroll', onEyeMove, { capture: true, passive: true });
        if ('onscrollend' in W) eye.offScrollEnd = on(W, 'scrollend', onEyeScrollEnd, { capture: true, passive: true });
        eye.offResize = on(W, 'resize', onEyeMove, { passive: true });
      }
      if (eye.videoEl !== videoEl) {
        eye.videoEl = videoEl || null;
        if (eye.ro) { try { eye.ro.disconnect(); } catch (_) {   } eye.ro = null; }
        if (videoEl && typeof ResizeObserver === 'function') {
          try { eye.ro = new ResizeObserver(scheduleEyePos); eye.ro.observe(videoEl); } catch (_) { eye.ro = null; }
        }
      }
      positionEyeFixed();
    }
    function renderEyeText() {
      if (!eye.parts) return;
      const t = eye.state === 'done' ? eyeDoneText() : (eye.shownLeft == null ? '' : fmtLeft(eye.shownLeft) + ' left');
      if (eye.parts.lft.textContent !== t) eye.parts.lft.textContent = t;
      const ratio = eye.state === 'done' ? 1 : (eye.progressMax > 0 && eye.shownLeft != null ? Math.max(0, Math.min(1, 1 - eye.shownLeft / eye.progressMax)) : 0);
      eye.parts.fill.style.transform = 'scaleX(' + ratio + ')';
      const n = Math.round(Number(eye.opts && eye.opts.amount) || 0);
      eye.parts.reward.textContent = n > 0 ? '+' + n : '';
    }
    function eyeDoneText() {
      const n = Math.round(Number(eye.opts && eye.opts.amount) || 0);
      return n > 0 ? '+' + n : '';
    }
    function eyeTick() {
      if (destroyed || !eye.el || eye.state !== 'counting' || docHidden() || eye.shownLeft == null) { eye.iv = stopEvery(eye.iv); return; }
      const el = Math.floor((now() - eye.anchorAt) / 1000);
      const target = Math.max(0, eye.anchorLeft - Math.min(5, Math.max(0, el)));
      if (target < eye.shownLeft) { eye.shownLeft = target; renderEyeText(); }
      if (eye.shownLeft <= 0) eye.iv = stopEvery(eye.iv);
    }
    function syncEyeTimer() {
      const want = !!eye.el && eye.state === 'counting' && !docHidden() && eye.shownLeft != null && eye.shownLeft > 0;
      if (want && eye.iv == null) eye.iv = every(eyeTick, 1000);
      else if (!want && eye.iv != null) eye.iv = stopEvery(eye.iv);
    }
    function watchPill(o) {
      if (destroyed) return;
      if (!o) { removeEye(); eye.doneFor = null; return; }
      let st = EYE_STATES[o.state] ? o.state : 'paused';
      if (canEarn === false && st !== 'done') st = 'gate';
      if (st === 'done' && !eye.el && eye.doneFor && eye.doneFor === (o.host || o.videoEl)) return;
      if (st !== 'done') eye.doneFor = null;
      const prev = eye.state;
      if (o.host) mountEyeInHost(o.host);
      else if (o.videoEl) mountEyeFixed(o.videoEl);
      else { removeEye(); return; }
      eye.opts = o;
      eye.state = st;
      const sl = o.secondsLeft != null && Number.isFinite(Number(o.secondsLeft)) ? Math.max(0, Math.ceil(Number(o.secondsLeft))) : null;
      const progressFor = o.videoEl || o.host;
      if (eye.progressFor !== progressFor || (sl != null && (eye.progressMax == null || sl > eye.progressMax || (eye.anchorLeft != null && sl > eye.anchorLeft + 5)))) {
        eye.progressFor = progressFor; eye.progressMax = sl;
      }
      if (sl == null) { eye.shownLeft = null; eye.anchorLeft = null; }
      else {
        if (sl !== eye.anchorLeft || (st === 'counting' && prev !== 'counting')) { eye.anchorLeft = sl; eye.anchorAt = now(); }
        if (eye.shownLeft == null || prev == null || sl > eye.shownLeft + 5) eye.shownLeft = sl;
        else eye.shownLeft = Math.min(eye.shownLeft, sl);
      }
      const p = eye.el;
      p.classList.toggle('tap', !!o.tappable);
      p.classList.toggle('off', st !== 'counting' && st !== 'ad' && st !== 'done');
      p.classList.toggle('ad', st === 'ad');
      p.classList.toggle('done', st === 'done');
      const reason = st === 'counting' || st === 'done' ? '' : '· ' + watchReason(st);
      if (eye.parts.why.textContent !== reason) eye.parts.why.textContent = reason;
      eye.parts.why.className = 'why' + (st === 'starting' ? ' soft' : '');
      renderEyeText();
      if (prev !== st || eye.fresh) { eye.fresh = false; deoverlapEye(); }
      if (prev && prev !== 'counting' && st === 'counting' && motionOK()) {
        p.classList.remove('blink');
        try { void p.offsetWidth; } catch (_) {   }
        p.classList.add('blink');
      }
      if (st === 'done') {
        if (!eye.doneT) {
          p.classList.remove('gone');
          if (motionOK()) anim(eye.parts.box, [{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: SQUASH_MS });
          eye.doneT = later(() => {
            eye.doneT = null;
            eye.doneFor = eye.hostEl || eye.videoEl;
            const fade = motionOK() && eye.el ? anim(eye.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }, () => removeEye()) : null;
            if (!fade) removeEye();
          }, DONE_HOLD_MS);
        }
      } else eye.doneT = cancel(eye.doneT);
      syncEyeTimer();
    }

    const store = () => {
      try { return typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local ? chrome.storage : null; } catch (_) { return null; }
    };
    function invalidated(err) { return /context invalidated/i.test(String((err && err.message) || err || '')); }
    function quietDown(err) { if (invalidated(err)) { try { api.destroy(); } catch (_) {   } } }
    function applyPrefs(p) {
      let touched = false;
      if (p && typeof p.sound === 'boolean' && p.sound !== prefs.sound) { prefs.sound = p.sound; touched = true; }
      if (p && typeof p.guide === 'boolean' && p.guide !== prefs.guide) { prefs.guide = p.guide; touched = true; }
      renderPrefs();
      if (!prefs.sound) { disarmAudio(); suspendAudio(); } else armAudio();
      if (touched || p) refreshPointer();
    }
    function setPrefs(p) { if (destroyed) return; applyPrefs(p || {}); }
    function setPref(k, v) {
      applyPrefs({ [k]: v });
      const st = store();
      if (!st) return;
      try {
        const r = st.local.set({ [k === 'sound' ? PREF_SOUND : PREF_GUIDE]: v });
        if (r && typeof r.catch === 'function') r.catch(quietDown);
      } catch (err) { quietDown(err); }
    }
    function savePos() {
      const st = store();
      if (!st || !platform) return;
      try {
        const r = st.local.set({ [POS_KEY + platform]: userPos });
        if (r && typeof r.catch === 'function') r.catch(quietDown);
      } catch (err) { quietDown(err); }
    }
    function readStore() {
      const st = store();
      if (!st) return;
      const keys = [PREF_SOUND, PREF_GUIDE, POS_KEY + platform];
      const apply = (s) => {
        if (destroyed || !s) return;
        applyPrefs({
          sound: typeof s[PREF_SOUND] === 'boolean' ? s[PREF_SOUND] : undefined,
          guide: typeof s[PREF_GUIDE] === 'boolean' ? s[PREF_GUIDE] : undefined,
        });
        const pos = s[POS_KEY + platform];
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && !kick) { userPos = { x: pos.x, y: pos.y }; layout(); }
      };
      try {
        const r = st.local.get(keys);
        if (r && typeof r.then === 'function') r.then(apply, quietDown);
      } catch (err) { quietDown(err); }
      try {
        if (st.onChanged && typeof st.onChanged.addListener === 'function') {
          const fn = (ch, area) => {
            if (destroyed || (area && area !== 'local') || !ch) return;
            const p = {};
            if (ch[PREF_SOUND] && typeof ch[PREF_SOUND].newValue === 'boolean') p.sound = ch[PREF_SOUND].newValue;
            if (ch[PREF_GUIDE] && typeof ch[PREF_GUIDE].newValue === 'boolean') p.guide = ch[PREF_GUIDE].newValue;
            if ('sound' in p || 'guide' in p) applyPrefs(p);
          };
          st.onChanged.addListener(fn);
          offs.add(function offStore() { offs.delete(offStore); try { st.onChanged.removeListener(fn); } catch (_) {   } });
        }
      } catch (err) { quietDown(err); }
    }

    function wraps() { return [wrap, docked && docked.wrap, eye.wrap && eye.shadowHost ? eye.wrap : null].filter(Boolean); }
    function onVisibility() {
      const h = docHidden();
      wraps().forEach((w) => w.classList.toggle('pgh', h));
      if (h) {
        suspendAudio(); hideTip(); hideWin();
        Array.from(anims).forEach((a) => { try { a.cancel(); } catch (_) {   } });
      }
      syncEyeTimer();
      if (!h && eye.state === 'counting' && eye.el) eyeTick();
    }
    on(D, 'visibilitychange', onVisibility);
    let fsFrom = null;
    function onFullscreen() {
      const fs = fsEl();
      if (fs && fs.nodeType === 1 && String(fs.tagName).toUpperCase() !== 'VIDEO') {
        if (!(typeof fs.contains === 'function' && fs.contains(host))) {
          if (!fsFrom) fsFrom = host.parentNode;
          try { fs.appendChild(host); } catch (_) {   }
        }
      } else if (!fs && fsFrom) {
        const back = fsFrom.isConnected !== false ? fsFrom : home();
        fsFrom = null;
        if (back && host.parentNode !== back) { try { back.appendChild(host); } catch (_) {   } }
      }
      if (fs) setOpen(false);
      layout();
      refreshPointer();
      if (eye.mode === 'fixed') positionEyeFixed();
    }
    on(D, 'fullscreenchange', onFullscreen);
    on(D, 'webkitfullscreenchange', onFullscreen);
    if (mq) {
      const fn = (e) => {
        reduced = !!(e && e.matches);
        if (reduced) {
          hideWin();
          Array.from(anims).forEach((a) => { try { a.cancel(); } catch (_) {   } });
        }
      };
      try {
        if (typeof mq.addEventListener === 'function') on(mq, 'change', fn);
        else if (typeof mq.addListener === 'function') {
          mq.addListener(fn);
          offs.add(function offMq() { offs.delete(offMq); try { mq.removeListener(fn); } catch (_) {   } });
        }
      } catch (_) {   }
    }

    function tick() {
      if (destroyed) return;
      if (!host.isConnected) { const t = fsEl() && String(fsEl().tagName).toUpperCase() !== 'VIDEO' ? fsEl() : home(); try { t.appendChild(host); } catch (_) {   } }
      if (docked && docked.shost.parentNode !== docked.el && docked.el.isConnected !== false) { try { docked.el.appendChild(docked.shost); } catch (_) {   } }
      if (eye.mode === 'host' && eye.shadowHost && eye.hostEl && eye.shadowHost.parentNode !== eye.hostEl && eye.hostEl.isConnected !== false) {
        try { eye.hostEl.appendChild(eye.shadowHost); } catch (_) {   }
      }
      if (docHidden()) return;
      if (userPos) setDockPos(clampX(userPos.x), clampY(userPos.y));
      else collisionShift();
    }
    function destroy() {
      if (destroyed) return;
      destroyed = true;
      timers.forEach((id) => clearTimeout(id)); timers.clear();
      intervals.forEach((id) => clearInterval(id)); intervals.clear();
      if (typeof cancelAnimationFrame === 'function') rafs.forEach((id) => { try { cancelAnimationFrame(id); } catch (_) {   } });
      rafs.clear();
      Array.from(anims).forEach((a) => { try { a.cancel(); } catch (_) {   } });
      anims.clear();
      if (ptr.io) { try { ptr.io.disconnect(); } catch (_) {   } ptr.io = null; }
      if (eye.ro) { try { eye.ro.disconnect(); } catch (_) {   } eye.ro = null; }
      Array.from(offs).forEach((f) => f());
      offs.clear();
      snd.offs = []; snd.armed = false;
      if (snd.ctx) { try { const p = snd.ctx.close && snd.ctx.close(); if (p && p.catch) p.catch(() => {}); } catch (_) {   } snd.ctx = null; }
      [host, docked && docked.shost, eye.shadowHost].forEach((h) => { if (h) { try { h.remove(); } catch (_) {   } } });
      try { const st = D.getElementById && D.getElementById(DOCK_STYLE_ID); if (st) st.remove(); } catch (_) {   }
      if (live === api) live = null;
    }
    function state() {
      return {
        platform, kick, total, shown, inflight, canEarn,
        chip: { text: chip.textContent, red: chip.className.indexOf('red') >= 0, hidden: chip.className.indexOf('off') >= 0 },
        steps: steps.length, open, blocked, notice, prefs: { sound: prefs.sound, guide: prefs.guide },
        pos: { left: dockPos.left, top: dockPos.top, dragged: !!userPos, docked: !!docked },
        pointer: {
          active: !!ptr.spec, kind: ptr.kind, visible: ptr.shown && !guide.classList.contains('hide'),
          hover: guide.classList.contains('hover'), rest: guide.classList.contains('rest'), x: ptr.x, y: ptr.y,
        },
        pill: eye.el ? {
          state: eye.state, mode: eye.mode, left: eye.parts ? eye.parts.lft.textContent : '',
          why: eye.parts ? eye.parts.why.textContent : '', counting: eye.iv != null, moving: !!eye.moving,
        } : null,
        tip: { visible: tipEl.classList.contains('show'), text: tipTx.textContent },
        version: { text: verBtn.textContent, enabled: !verBtn.disabled },
        reduced, destroyed,
        timers: timers.size + intervals.size, rafs: rafs.size, anims: anims.size, listeners: offs.size,
      };
    }

    const CC_CSS = '.cc{position:absolute;left:0;top:0;width:340px;box-sizing:border-box;padding:18px 18px 14px;border-radius:18px;'
      + 'background:#060b15;border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 50px rgba(0,0,0,.6);color:#f2f5f8;'
      + 'font:14px/1.45 system-ui,-apple-system,"Segoe UI",Arial,sans-serif;text-align:center;pointer-events:auto;z-index:4}'
      + '.cc .k{width:44px;height:44px;margin:0 auto 10px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:rgba(83,252,24,.14);color:#53fc18}'
      + '.cc .k svg{width:22px;height:22px}'
      + '.cc .t{font-size:19px;font-weight:800;line-height:1.2;margin:0 0 6px}'
      + '.cc .d{font-size:13.5px;color:rgba(255,255,255,.66);margin:0 0 14px}'
      + '.cc .go{position:relative;isolation:isolate;display:flex;align-items:center;justify-content:center;gap:9px;width:100%;min-height:48px;border:0;border-radius:12px;cursor:pointer;'
      + 'font:800 15px system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#08101E;background:linear-gradient(135deg,#00F5A0,#22E0FF);'
      + 'box-shadow:0 4px 18px -6px rgba(0,245,160,.5);animation:rgcCcBeat 1.8s ease-in-out infinite}'
      + '.cc .go svg{width:16px;height:16px}'
      + '.cc .go::before{content:"";position:absolute;inset:-5px;z-index:-1;border-radius:15px;background:linear-gradient(135deg,#00F5A0,#22E0FF);'
      + 'filter:blur(12px);opacity:.3;animation:rgcCcGlow 1.8s ease-in-out infinite;pointer-events:none}'
      + '@keyframes rgcCcBeat{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}'
      + '@keyframes rgcCcGlow{0%,100%{opacity:.25}50%{opacity:.9}}'
      + '.cc .no{margin-top:8px;border:0;background:none;color:rgba(255,255,255,.55);font:600 12.5px system-ui,sans-serif;cursor:pointer;padding:6px 10px}'
      + '.pgh .cc .go,.pgh .cc .go::before{animation-play-state:paused}'
      + '@media (prefers-reduced-motion:reduce){.cc .go,.cc .go::before{animation:none}}'
      + '@media (max-width:420px){.cc{width:calc(100vw - 24px)}}';
    const KICK_PATH = 'M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z';
    let cc = null;
    function kickSvg() {
      const NS = 'http://www.w3.org/2000/svg';
      const sv = D.createElementNS(NS, 'svg'); sv.setAttribute('viewBox', '0 0 24 24'); sv.setAttribute('fill', 'currentColor'); sv.setAttribute('aria-hidden', 'true');
      const pth = D.createElementNS(NS, 'path'); pth.setAttribute('d', KICK_PATH); sv.appendChild(pth);
      return sv;
    }
    function placeConnectCard() {
      if (!cc) return;
      const el = cc.el, w = el.offsetWidth || 340, h = el.offsetHeight || 220;
      let left, top;
      let vr = null;
      try { if (cc.videoEl && cc.videoEl.isConnected !== false) vr = cc.videoEl.getBoundingClientRect(); } catch (_) { vr = null; }
      if (vr && vr.width > 120 && vr.height > 100 && vr.bottom > 60 && vr.top < viewH() - 60) {
        left = vr.left + vr.width / 2 - w / 2;
        top = Math.max(vr.top, 0) + Math.min(vr.height, viewH()) / 2 - h / 2;
      } else {
        left = dockPos.left; top = dockPos.top + COUNTER_H + GAP;
      }
      el.style.left = Math.round(Math.max(8, Math.min(left, viewW() - w - 8))) + 'px';
      el.style.top = Math.round(Math.max(8, Math.min(top, viewH() - h - 8))) + 'px';
    }
    function connectCard(o) {
      if (destroyed) return false;
      if (!o) {
        if (cc) { cc.offs.forEach((f) => f()); try { cc.el.remove(); } catch (_) {   } cc = null; }
        return true;
      }
      if (!cc) {
        if (!root.querySelector('style[data-cc]')) { const st = mk('style'); st.setAttribute('data-cc', ''); st.textContent = CC_CSS; root.appendChild(st); }
        const el = mk('div', 'cc');
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-label', 'Connect Kick to earn tickets');
        const k = mk('div', 'k'); k.appendChild(kickSvg());
        const t = mk('p', 't', o.title || 'Connect Kick to earn tickets');
        const d = mk('p', 'd', o.text || 'This post pays tickets. Connect the extension with your Kick account to start earning.');
        const go = mk('button', 'go'); go.type = 'button'; go.appendChild(kickSvg()); go.appendChild(D.createTextNode(o.button || 'Connect with Kick'));
        const no = mk('button', 'no', 'Not now'); no.type = 'button';
        el.appendChild(k); el.appendChild(t); el.appendChild(d); el.appendChild(go); el.appendChild(no);
        stopBubble(el);
        wrap.appendChild(el);
        cc = { el, offs: [], t: null };
        on(go, 'click', () => { try { if (cc && typeof cc.onConnect === 'function') cc.onConnect(); } catch (_) {   } });
        on(no, 'click', () => { const f = cc && cc.onDismiss; connectCard(null); try { if (typeof f === 'function') f(); } catch (_) {   } });
        const settle = () => { if (!cc) return; cc.t = cancel(cc.t); cc.t = later(() => { if (cc) { cc.t = null; placeConnectCard(); } }, 160); };
        cc.offs.push(on(W, 'scroll', settle, { passive: true, capture: true }));
        cc.offs.push(on(W, 'resize', settle, { passive: true }));
      }
      cc.videoEl = o.videoEl || null;
      cc.onConnect = o.onConnect;
      cc.onDismiss = o.onDismiss;
      placeConnectCard();
      return true;
    }

    const api = {
      host, connectCard,
      setTotal, setCanEarn, setSteps, setBlocked, setNotice, setVersion, setReport,
      pointTo, cashIn, reject, tip, watchPill, setPrefs, destroy,
      tick, relayout: layout, dock, owns: ownsEvent, state,
      open: (v) => setOpen(v !== false),
    };
    live = api;

    renderNum(); renderChip(); renderPrefs(); renderVer();
    if (docHidden()) wrap.classList.add('pgh');
    if (kick && opts.container) dock(opts.container, { hideWhen: opts.hideWhen });
    else layout();
    armAudio();
    readStore();
    return api;
  }

  function removeOrphans(D) {
    try {
      if (typeof D.querySelectorAll !== 'function') return;
      const stale = D.querySelectorAll('#' + HOST_ID + ',#' + DOCK_ID + ',#' + EYE_ID + ',#' + DOCK_STYLE_ID);
      for (let i = 0; i < stale.length; i++) { try { stale[i].remove(); } catch (_) {   } }
    } catch (_) {   }
  }

  return {
    create, burstPlan, stepsProgress, fmtLeft, watchReason, watchTipText, canPoint, ownsEvent,
    COPY, INSET, PILL_H,
  };
})();
