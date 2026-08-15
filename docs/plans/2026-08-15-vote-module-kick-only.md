# Vote Module Lives Only Inside Kick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (Session pattern: plan on Fable, execute on Opus, inline.)

**Goal:** Kill the detached vote/stake pop-up window so voting and staking only happen as the module inside Kick's page for mizkif — the channel page (already built) and the moderator dashboard (new). Off-Kick users get a notification that opens the stream, not a betting UI.

**Why (owner, 2026-08-15):** people mute the stream and wait for the pop-out to play without watching. `background.js` pops a detached 360×320 window with the FULL desk stake UI whenever a poll/round opens and the viewer is NOT on Kick — it fires precisely for the people who aren't watching.

**Architecture:** All changes in `/opt/rinaudo-extension` (public repo `SolutionsCMD/rinaudo-extension`, branch `master`, v1.126 everywhere). No engine/portal work. The on-page card on `kick.com/mizkif*` already renders polls AND stake rounds via shared `vote/stake-panel.js`, so this plan deletes the pop-out, swaps its two triggers for a notification, and adds the dashboard as a second injection point.

**Verified facts (2026-08-15, do not re-derive):**
- The ONLY off-Kick vote path is `openVoteWindow()` (`background.js:294`), called from two trigger sites (~319 poll, ~329 round), both gated on `!(await focusedOnKick())`. Toolbar popup cannot vote; notifications don't vote.
- `vote/vote.html` is referenced only at `background.js:300`. `vote/stake-panel.js` is SHARED with the on-page card (`kick.js` content_script list) — keep it.
- Notification clicks (body and button) already open `notifUrls[id] || C.CHANNEL_URL` where `CHANNEL_URL = 'https://kick.com/mizkif'`. So a poll notification with no notifUrls entry opens the stream — zero new click plumbing.
- `notify()` is feature-guarded (`HAS_NOTIFICATIONS`); mobile Firefox has neither windows nor notifications APIs, so it never had the pop-out and loses nothing (memory: every change MUST keep working on mobile Firefox).
- `dashboard.kick.com` appears in NO manifest today. Adding it is a NEW host permission → Chrome may disable the extension for every user until they re-approve. This is why Task 2 verifies on a scratch profile BEFORE the owner decides to ship it in the same release.
- Tests: `node --test test/` (mjs suites); three-way manifest check `node scripts/release-checks.mjs`.
- User-facing copy rules: no em dashes, no AI-tell phrasing.

---

## Task 1: Pop-out window → notification

**Files:** Modify `background.js`. Delete `vote/vote.html`, `vote/vote.js`.

- [ ] **Step 1:** In `background.js`, delete the whole pop-out apparatus: the `openVoteWindow()` function, the `chrome.windows.onRemoved` listener that clears `voteWin`, and the `HAS_WINDOWS` const (its only remaining consumers are these two). Grep `voteWin` and `HAS_WINDOWS` afterwards: both must have zero hits.
- [ ] **Step 2:** Replace the POLL trigger site (inside `checkPoll()`, the `key !== lastPollKey` branch):

```js
      // A vote is something you cast while watching. Off-Kick viewers get a nudge to
      // the stream, not a betting UI: the pop-out window this replaced fired precisely
      // for people who were not watching (owner, 2026-08-15).
      if (!(await focusedOnKick())) {
        notify('rgc-poll-' + poll.id, {
          type: 'basic', iconUrl: 'icons/icon128.png',
          title: 'Vote is live on stream',
          message: 'A community vote just opened. It is on Mizkif\'s Kick page. Click to watch and vote.',
          buttons: [{ title: 'Open the stream' }], priority: 2,
        });
      }
```

- [ ] **Step 3:** Replace the ROUND trigger site (the `key !== lastRoundKey` branch) the same way:

```js
      if (!(await focusedOnKick())) {
        notify('rgc-round-' + round.id + '-' + round.status, {
          type: 'basic', iconUrl: 'icons/icon128.png',
          title: round.status === 'joining' ? 'Final window is open' : 'Staking is live on stream',
          message: 'Tickets are moving on Mizkif\'s Kick page. Click to watch and place yours.',
          buttons: [{ title: 'Open the stream' }], priority: 2,
        });
      }
```

  Do NOT write `notifUrls` entries for these ids: the click handler's fallback is already `C.CHANNEL_URL`, which is exactly where we want them sent. Keep the existing `lastPollKey`/`lastRoundKey` dedupe unchanged (one nudge per poll / per round-phase).
- [ ] **Step 4:** `git rm vote/vote.html vote/vote.js`. Then `grep -rn "vote/vote" . --exclude-dir=.git` → zero hits.
- [ ] **Step 5:** Sweep user-facing copy for mentions of a separate vote window: `grep -rniE "pop.?(up|out).{0,40}(vote|window)|vote.{0,20}window" welcome.html welcome.js popup/ STORE.md docs/` and rewrite any hit to describe the on-stream module instead. (Copy rules: no em dashes, no AI-tell phrasing.)
- [ ] **Step 6:** Run `node --test test/` (all pass; nothing tests the pop-out) and `node scripts/release-checks.mjs` (three-way manifest parity still holds; no manifest change yet in this task).
- [ ] **Step 7:** Commit: `git add -A && git commit -m "feat: retire the detached vote window; off-Kick viewers get a stream nudge"`

## Task 2: The module on the moderator dashboard

**Files:** Modify `manifest.json`, `manifest.firefox.json`, `manifest.safari.json`, `content/kick.js`.

- [ ] **Step 1 (decide before writing code): verify the permission cost on a scratch Chrome profile.** Load the CURRENT unpacked extension, then add `https://dashboard.kick.com/*` to `host_permissions` + the content_script block below, reload, and observe whether Chrome flags the extension disabled pending re-approval. Record the result in the commit message. **If Chrome disables it: STOP and surface to the owner** — shipping that to the fleet silently kills ticket earning for everyone who ignores the prompt, and the dashboard module should then ship as its own release the owner announces on stream. If Chrome keeps it enabled (per-site toggle only), proceed.
- [ ] **Step 2:** In all THREE manifests, add to `host_permissions`: `"https://dashboard.kick.com/*"`, and add a content_scripts entry mirroring the kick.com one:

```json
    {
      "matches": ["https://dashboard.kick.com/moderator/mizkif*"],
      "js": ["config.js", "content/widget-frame.js", "vote/stake-panel.js", "content/kick.js"],
      "run_at": "document_idle"
    }
```

  (Copy `run_at` from the existing kick.com block if it differs.)
- [ ] **Step 3:** In `content/kick.js`, top of file, add a host flag and use it to keep the dashboard vote-only:

```js
// The moderator dashboard gets the vote module only. Watch-time stays a channel-page
// thing: crediting kick checkins for sitting on the mod dashboard would recreate the
// AFK-earning problem this change exists to shrink (owner, 2026-08-15).
const ON_MOD_DASHBOARD = location.hostname === 'dashboard.kick.com';
```

  Then guard every watch-time site: the `wtFrame` mount and any kick checkin/heartbeat call gets `if (!ON_MOD_DASHBOARD) ...`. Find them with `grep -n "wtFrame\|checkin" content/kick.js` and guard each; the poll/stake card path stays unguarded.
- [ ] **Step 4:** Also update `focusedOnKick()` in `background.js` to count the dashboard as "on Kick" so mods there don't get redundant nudges:

```js
    return !!(tab && /^https:\/\/(kick\.com\/mizkif|dashboard\.kick\.com\/moderator\/mizkif)/.test(tab.url || ''));
```

- [ ] **Step 5:** Manual check (scratch profile, logged into Kick as a mod if possible; otherwise verify the card mounts on the URL even if the page 403s the stream): card appears bottom-right on `dashboard.kick.com/moderator/mizkif`, poll voting works, NO watch-time frame appears. On `kick.com/mizkif` everything is unchanged.
- [ ] **Step 6:** `node scripts/release-checks.mjs` (three manifests must stay in lockstep). Commit: `git add -A && git commit -m "feat: vote module on the moderator dashboard (vote-only, no watchtime)"`

## Task 3: Version, build, hand to owner

- [ ] **Step 1:** Bump `"version"` to `1.127` in all three manifests. `node scripts/release-checks.mjs` must pass.
- [ ] **Step 2:** `./build.sh` → fresh `rinaudo-extension-chrome.zip`, `-firefox.zip`, `-safari.zip`.
- [ ] **Step 3:** `node --test test/` once more, then commit and push to `master` (owner authorized pushes on this repo).
- [ ] **Step 4:** Report to the owner: what changed, the Task 2 Step 1 permission verdict, and that store publishing (Chrome/AMO) is his step. Remind him mobile Firefox never had the pop-out, so nothing regresses there, and that the residual loophole (muted Kick tab left open, on-page card still votable) is NOT closed by this change — gating the card on the player actually playing is a separate decision if he wants it.

---

## Self-review notes
- Spec coverage: pop-out removed (T1), module inside Kick's window on both URLs he named (kick.com/mizkif already exists; dashboard added in T2), nudge replaces the window (T1), release (T3).
- Deliberately out of scope: requiring the stream to be audibly playing to vote (owner has not asked; flagged in T3 report), `voteCard` popup toggle (leaving it: a member who hides the card can still vote on the website).
- Risk called out rather than buried: the dashboard host permission may disable the extension fleet-wide on update; T2 cannot proceed past Step 1 without evidence.
