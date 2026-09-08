# YouTube comment integrity — plan

Planned on Fable 2026-09-08, for Opus to execute. Owner: "its on youtube, cant you just
check if they hit the delete button? also i dont think 100 people are deleting their
comments, you might be crediting them before they comment."

Both of his points are right, and both are fixed here.

## What was found (verified, read only)

- 15,349 YouTube comment credits in the last 30 days (52% of all comment credits).
- On 12 recent videos, credits paid EXCEED the total number of comments the video has,
  by at least 934. That is a floor: the live count includes every non-member too.
- The credit stores `youtube:<videoId>` and nothing else. No comment id, no text. So the
  past cannot be split into "never posted" versus "deleted", and nothing from before this
  change can be clawed back. Say that plainly if asked.

### Cause A — credits for comments that were never posted (the owner's hunch)

`content/engage-core.js` `hookComment()` on YouTube credits from the DOM:

1. `watchForPostedComment()` arms on ANY click while a gate-passing text (7+ words) is
   in ANY contenteditable on the page, and credits the moment the composer reads empty
   within 4s. **Clicking Cancel empties the composer.** Cancel = credit.
2. `commentSubmitTarget` matches `#submit-button` anywhere on the page, and
   `commentText()` returns text from ANY contenteditable, so an unrelated submit button
   with a stale reply box open also credits.
3. `content/observe.js` already carries a YouTube `create_comment` network signature
   (language-proof, carries the typed text), and engage-core credits on it too. But
   `content/youtube.js` never set `commentConfirmNetwork`, so the DOM paths above stay
   live beside it. TikTok had exactly this bug (2,148 false tickets in two days,
   2026-08-23) and was fixed by making the network request the ONLY signal (1.161).

### Cause B — deleting after credit

Nothing watches for it. Delete is free.

## Decisions (made; do not widen without asking)

- **YouTube comments credit only on YouTube's own `create_comment` request.** Same model
  as TikTok. Composer-clear and submit-button paths are OFF for YouTube.
- **A member who deletes their comment on a target loses that target's comment ticket
  and cannot re-earn it.** One comment per target already; the original `comment` ledger
  row stays (it is the dedupe), a reversal row lands beside it.
- **Never drive tickets below zero.** If the ticket is already spent, take what is there
  and record the shortfall (the `undoRefund` precedent in `lib/red-sell.ts`).
- **The 2-ticket do-it-all bonus is left alone** on a delete. Flagged below, owner's call.
- **Old clients get refused, not trusted**, via the existing `min_client` gate
  (`app_config.min_client["youtube:comment"] = "1.173"`), armed by the owner AFTER the
  store release is live, exactly as `tiktok:comment` 1.161 was.
- Extension version: **1.173**. Firefox first; mobile Firefox (m.youtube.com) must keep
  working (standing rule).

## Tasks — extension (`/opt/rinaudo-extension`)

1. **`content/youtube.js`: `commentConfirmNetwork: true`.** engage-core's `hookComment`
   returns before registering any DOM listener when this is set (line ~890), so the
   Cancel path and the `#submit-button` path both die. The observe.js signal at
   engage-core ~784 keeps crediting (ref-less, page-scoped, text gate applies). Keep the
   `create_comment_reply` variant matching; a reply is a comment today and stays one.

2. **Carry the comment id when it can be read (best effort, optional).** After the
   network confirm, poll the DOM for up to ~6s for the newest comment element
   (`ytd-comment-view-model`, `ytd-comment-renderer`, `ytm-comment-renderer`) whose text
   matches `d.txt`; read its id from the permalink `a[href*="lc="]` (`lc=<commentId>`).
   No id found → send `null`, the credit still stands. Extend `fireEngagement` to take an
   `extra` object and `background.js` `s2Engagement` to forward `commentId` (string,
   `^[\w-]{8,64}$`). **Never send comment text** (observe.js's own rule: content is not
   ours to ship). The headless probe from the box could not render comments, so the
   executor verifies the `lc=` link on a real browser before relying on it; if YouTube
   has dropped it, ship without the id — the delete detector below does not need it.

3. **Delete detector, language-proof, no button text.** Three signals inside a 10s
   window, all required:
   - a confirm dialog confirm click (`yt-confirm-dialog-renderer #confirm-button`,
     `tp-yt-paper-dialog` confirm, or the m.youtube sheet equivalent);
   - a comment element REMOVED from the DOM (MutationObserver on the comments section),
     ideally the one whose action menu was last opened (track the last
     `#action-menu` / `ytd-menu-renderer` click inside a comment);
   - a `POST /youtubei/v1/comment/perform_comment_action` seen by observe.js: add a
     signature `{ platform:'youtube', kind:'comment_action', ref: null }` (that endpoint
     also serves like/pin/report, which is why the DOM removal is required too).
   On all three: send `s2CommentDeleted { platform:'youtube', ref: state.ref, commentId }`
   (commentId from the removed element's `lc=` link if present, else null). Only when
   `state.commentS === 'done'` for this ref — a delete of a comment we never credited is
   nothing to us. Set local state to `voided`; widget row reads
   "Comment deleted, ticket returned" (no dashes in copy, house rule).
   The executor MUST verify the delete flow on a real signed-in account, desktop and
   m.youtube, using a throwaway comment on a live target; the owner can do this on stream
   or off. Nothing here can be verified headless from the box.

4. **Tests** in `test/`: `engage-core.test.mjs` — YouTube with `commentConfirmNetwork`
   credits on the network signal and NOT on composer clear or Cancel; the three-signal
   delete fires once, and not on a cancelled dialog or on a `perform_comment_action`
   alone. `observe-body.test.mjs` — the new `comment_action` signature matches
   `perform_comment_action` and nothing else under `/comment/`.

5. **Release**: bump BOTH manifests to 1.173, `./package.sh`, submit Firefox then Chrome
   per STORE.md. Do not arm the gate yet (task 12).

## Tasks — engine (`/opt/rinaudo-s2/web`)

6. **Migration `056_comment_claims.sql`**:
   `comment_claims (id bigserial pk, season_id, user_id, platform text, target_ref text,
   comment_id text null, client text null, created_at timestamptz default now(),
   deleted_at timestamptz null, reversed int null, shortfall int null,
   unique (season_id, user_id, target_ref))`. One row per credited comment per target.

7. **`POST /api/extension/engagement`**: accept optional `commentId`; after
   `awardComment` records (recorded true, including the zero-reward case), upsert
   `comment_claims` with `client = X-RGC-Client`. Any platform may send it; only YouTube
   will today. Malformed id → 400, same as any other bad field.

8. **New `POST /api/extension/engagement/delete`** (bearer, CORS like its sibling):
   body `{ platform, ref, commentId? }`. Resolve `normRef` + epoch → `targetRef` the same
   way. Find this member's `comment` ledger row for that `targetRef`; none → 200
   `{ voided:false, reason:'no_credit' }`. Already reversed (a `comment_deleted` row for
   the same ref) → 200 `{ voided:false, reason:'already' }`. Otherwise in one transaction:
   `paid = that row's delta`; `have = season_users.tickets`;
   `take = min(paid, have)`; if `take > 0` → `addTickets(delta: -take, reason:
   'comment_deleted', refType:'target', refId: targetRef)`; update `comment_claims`
   (`deleted_at, reversed = take, shortfall = paid - take`), inserting the row if the
   credit predates claims. If the claim carries a different `comment_id` than the one
   reported, still void (one comment per target) and record both ids in `audit_log`.
   Respond `{ voided:true, returned: take, shortfall }`.
   Rate-limit like the sibling route. Refuse platforms other than the ones we detect on
   (`youtube` only today) with 400 `unsupported_action`, mirroring the AVAILABLE table.

9. **`lib/engagement-awards.ts`**: nothing changes in `awardSocial`; the new reason
   `comment_deleted` must not collide with the partial unique indexes (it does not: they
   are per-reason). Add the reason to whatever ledger-reason list the portal/desk uses to
   label history, with copy "Comment deleted" (executor greps for `red_sell_refund` to
   find every such list).

10. **Targets route**: confirm the advertising side reads `min_client` generically for
    `youtube:comment` (the route comment says "the targets route must not ADVERTISE it").
    If it is keyed per platform by hand, add YouTube.

11. **Tests** (`tests/api-extension-engagement.test.ts` + a new
    `tests/comment-delete.test.ts`, vitest runs SERIALLY): claim stored with id and
    client; delete voids once and returns the ticket; second delete is `already`; delete
    with tickets already spent floors at zero and records shortfall; delete with no credit
    is `no_credit`; non-YouTube platform → 400; `min_client` youtube:comment armed →
    old client gets `update_required` on credit AND its comment task is not advertised.

12. **Deploy + arm**: engine main build (`DIST_DIR=…`, NOT `NEXT_DIST`) + restart →
    `tools/deploy-padmin.sh` (extension hits :4020 but the trees stay reconciled).
    Arm `min_client["youtube:comment"]="1.173"` only once both store listings show
    1.173 and a day has passed for auto-update, the way 1.161 was done. Until it is armed
    old clients keep crediting off the DOM; that is the accepted window.

13. **Backup before touching** (standing rule): the migration is additive, but snapshot
    `app_config` (`min_client`) before arming and print the rollback.

## Rollback

Extension: previous zips are kept beside the new ones; the store keeps the prior
version. Engine: routes are additive; `DELETE FROM app_config WHERE key='min_client'`
entry for `youtube:comment` re-admits old clients instantly. `comment_deleted` reversals
are ledger rows and can be re-credited by hand if ever needed (`addTickets` positive with
reason `comment_restored`).

## How we will know it worked

- `SELECT count(*) FROM ticket_ledger WHERE reason='comment_deleted'` per week, against
  YouTube `comment` credits per week. Deletions become a number instead of a hunch.
- Re-run the credits-versus-live-comments check on the next 12 videos two weeks after the
  gate is armed. The gap should collapse toward the non-member share. If it does not, the
  remaining gap is deletions by clients that never updated, and the gate handles that.
- `comment_claims.comment_id IS NULL` rate tells us whether the `lc=` read works in the
  wild; if it is mostly null, the delete detector still works, only the audit trail is
  thinner.

## Flagged for the owner, not done here

- **Likes (3) and reposts (5) have the same hole** and are worth 3 to 5 times more per
  undo. This plan is YouTube comments only. Same shape would work for un-like on YouTube
  (`perform_comment_action` is not it; likes go through `/youtubei/v1/like/removelike`,
  which observe.js could match) and for X un-repost (`DeleteRetweet`, which observe.js
  deliberately ignores today).
- The 2-ticket do-it-all bonus unlocked by a later-deleted comment stays paid.
- Other platforms' comment ids and deletes: out of scope.
- The 934+ already-paid phantom credits cannot be attributed and are written off.

---

## BUILT 2026-09-08 (Opus)

Everything above is built. Departures from the plan worth recording:

- **No portal copy change was needed.** The plan's task 9 assumed a member-facing map of
  ledger reasons on the portal. There isn't one; nothing labels `comment` today, so
  `comment_deleted` needs no label either.
- **The targets route needed no change** (task 10): its `tooOld()` reads `min_client`
  generically by `${platform}:${action}`, so `youtube:comment` gates the advertised task
  the moment it is armed.
- **`comment_claims` had to be added to `tests/helpers.ts` resetDb.** It is not truncated
  by default, and because the reset does `RESTART IDENTITY`, a surviving claim row is
  found by the NEXT test's freshly-numbered user. Any new table needs this line.
- The delete endpoint is deliberately **not** gated on `isActiveTarget`: a target can
  close between the comment being paid and the member deleting it, and the ticket should
  still come back.

Verified: engine `tests/comment-delete.test.ts` 8/8; extension
`test/youtube-comment-integrity.test.mjs` 7/7 and `test/observe-body.test.mjs` 15/15;
every other extension test file unchanged and passing.

### Still owner-side

1. Submit `rinaudo-extension-firefox.zip` then `rinaudo-extension-chrome.zip` (both built
   at 1.173, verified). Safari is built by CI from `manifest.safari.json`, also bumped.
2. **Verify the delete flow on a real signed-in account**, desktop and m.youtube: post a
   throwaway comment on a live target, confirm the ticket lands, delete it, confirm the
   row reads "Comment deleted, ticket returned" and the ticket goes. Nothing about this
   can be checked from the box; the headless probe could not even render YouTube comments.
3. **Arm the gate only after both listings show 1.173 and a day has passed** for
   auto-update:
   `INSERT INTO app_config (key,value) VALUES ('min_client','{"tiktok:comment":"1.161","instagram:share_send":"1.169","youtube:comment":"1.173"}'::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;`
   Until it is armed, old clients keep crediting off the DOM. That is the accepted window,
   the same one 1.161 had.
4. `STORE.md` still says "As of 8 August 2026 comments earn nothing on any platform".
   `comment_reward` is 1 today. Stale listing copy, left alone deliberately — changing
   store text mid-review is its own risk. Worth a pass when the next listing update goes in.
