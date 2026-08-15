# Store listing notes

**Name:** Mizkif Global (matches `name` in both manifests; the old listing name was "Rinaudo Capital")
**Summary:** Earn tickets for engaging with Mizkif: watch, like, and repost his posts and videos, vote on live polls, and get notified when he goes live or posts.

## What it does
Connect once with "Connect with Kick," then earn tickets in Mizkif's game by engaging
with his content:
- **Watch / like** his promoted posts and videos on YouTube, TikTok, and Instagram. A small
  card appears on the post, tracks what you have done on it, and credits the action.
- **Like / repost** his promoted posts on X. A repost credits only after X's own site
  confirms it (see "The X repost check" below).
- **Vote** on live polls from his Kick stream, on a card that sits over the stream
  itself, and earn watch time while that stream is playing. If you're on another tab
  when a vote opens, you get a notification that takes you back to the stream.
- **Notifications** when he goes live or posts (no login required for these).
The popup and the on-install welcome page show a live "How to earn" list, read from the
server, so the listed rewards are always the ones the season is actually paying.

What each action pays is a server-side season setting, not something the extension decides.
As of 8 August 2026 comments earn nothing on any platform, so the copy above no longer sells
them; the extension still detects a comment and reports it, and the game credits it at the
current rate of zero. Reposts are shipped but pay zero until the season's repost reward is
turned on, and only X has the confirmation signature today.

## Permissions justification (for review)
- **storage** - stores the member's auth token and small local state.
- **alarms** - a periodic timer to check for open polls and new content.
- **notifications** - desktop alerts when a poll opens or Mizkif goes live / posts.
- **host: https://s2.jsolutions.dev/** - the game API (connect, engagement, votes, watch, rates).
  The connect flow is a normal tab on `s2.jsolutions.dev/extension/connect`, so there is no
  `identity` permission and no `launchWebAuthFlow`.
- **host: https://rinaudoglobal.com/** - the public status feed that powers notifications (no login).
- **host: https://kick.com/** - show the vote card on Mizkif's channel page.
- **host: https://www.youtube.com/, https://m.youtube.com/, https://www.tiktok.com/,
  https://m.tiktok.com/, https://www.instagram.com/, https://instagram.com/, https://instagr.am/**
  - detect the member's likes / comments / watches on Mizkif's promoted posts and videos, so the
  game can credit them.
- **host: https://x.com/, https://twitter.com/** - detect the member's likes, replies, and reposts
  on his promoted posts, so the game can credit them, including the repost check below.

## The X repost check (reviewers will ask about `"world": "MAIN"`)
`content/observe.js` is the only content script that runs in the page's own world, and it is
declared on `x.com` and `twitter.com` only. A repost must not credit on a button click alone,
so this script watches the requests the X page itself sends:
- It tests the **URL** of each request. Only when the URL is X's own `CreateRetweet` GraphQL
  mutation does it look further, and the only thing it extracts is the **post id** from the
  request body X was already sending.
- It records whether the request was **accepted** (HTTP 2xx). That is a status flag, not content.
- It **never reads a response body** (that would consume the stream the page is about to read),
  never modifies, delays, or blocks a request or a response, and always returns the page's
  original promise and values untouched. Every piece of its logic sits inside try/catch, and it
  wraps `fetch` / `XMLHttpRequest` exactly once per window.
- It posts only `{platform, kind, ref, ok}` to the extension's own isolated world. No headers,
  no credentials, no page content.

## Data handling
- No analytics, advertising, behavioral tracking, or third-party sharing/selling.
- **Anti-fraud signals** (to stop one person farming tickets across many accounts / bots): each
  authenticated game-API request carries a randomly-generated **device token**, a **device
  fingerprint** (a one-way hash of graphics renderer / canvas / browser / timezone / CPU traits;
  the values behind the hash are not kept), and, in `X-RGC-Caps`, three **coarse device traits as
  plain values**: GPU renderer name, CPU core count, memory size. Those three are stored server-side
  next to the hash (`account_signals.gpu_renderer / hw_cores / hw_mem`) and feed a VM score. The
  server also keeps a **salted one-way hash of the IP** (never the raw IP) plus the **network
  operator (ASN) name** the IP resolves to. Used only to cluster apparently-linked accounts for
  manual review before payouts; never sold, shared, used for ads, or shown to other users.
- Stored locally: the member's revocable auth token, the anti-fraud device token + fingerprint hash,
  and small bookkeeping (last poll/video/post shown, on-page card position).
- Network calls go only to `s2.jsolutions.dev` (the game API) and `rinaudoglobal.com` (the public
  notifications feed).
- An engagement call sends three things: the platform and the post/video id (the same id in the
  post's public URL), the action (`like`, `comment`, `watch`, `repost`, `share_send`), and the
  member's auth token. Watching also sends periodic "still watching" signals. The Kick check-in
  (about once a minute while Mizkif's stream is playing) sends no body at all, only the auth token
  and the anti-fraud headers.
- Two diagnostic paths, both disclosed in the packaged privacy policy, so keep the two in sync if
  either payload changes:
  - `s2Debug`, kind `xcomment`, fires when a reply on X fails to register. It carries the event
    type, whether the page is a `/status/` page, the clicked `data-testid`, the modifier keys, and
    the **character count** of the draft. Never the draft text.
  - Selector health (`/api/extension/telemetry`) ships at most every 10 minutes and carries the
    extension version plus `{platform, kind, ref}` rows naming which control the adapter could not
    find on which post. No page content.
- Content scripts run only on Mizkif's Kick channel and on X / YouTube / TikTok / Instagram pages,
  only to detect the member's own deliberate engagement and show the extension's own card. They do
  not collect page content; comment text is checked locally for length only and is never
  transmitted. The single exception, stated plainly because the packaged privacy policy states it
  too: on X, `content/observe.js` reads the URL of the page's own requests and pulls the post id
  out of the repost mutation, as described above.

## Before submitting
- Host `privacy.html` at a public URL and put it in the listing's privacy field. It must stay in
  sync with the code: it now names x.com / twitter.com and describes the repost check.
- Confirm the host permissions list matches `manifest.json` (**12 hosts**: rinaudoglobal.com,
  s2.jsolutions.dev, kick.com, www.youtube.com, m.youtube.com, www.tiktok.com, m.tiktok.com,
  www.instagram.com, instagram.com, instagr.am, x.com, twitter.com).
- Bump `version` in both `manifest.json` and `manifest.firefox.json` (`./build.sh --set-version`),
  and run `node scripts/release-checks.mjs` before packaging.
- **Chrome Web Store -> Privacy practices:** declare the anti-fraud data collection (device
  identifier + device fingerprint + hashed IP + the plain GPU renderer / core count / memory sent in
  `X-RGC-Caps`). Disclose data type as a user/device identifier and
  select the purpose **"Fraud prevention, security, and compliance"** (plus App functionality). Do
  NOT check "does not collect user data"; that would be inaccurate now.
- **Firefox (AMO):** the manifest carries **no** `data_collection_permissions` key. AMO rejected
  `technicalAndInteraction` as an invalid enum value and the key was dropped in June 2026 (commit
  3d6bc5f). Do not re-add it without checking AMO's current accepted values first.
- Note: TikTok/Instagram engagement requires the matching backend support to be live to credit.
  Repost and send credit on X only; no other platform has a signature in `content/observe.js` yet.
