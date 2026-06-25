# Store listing notes

**Name:** Rinaudo Capital
**Summary:** Earn tickets for engaging with Mizkif — like, comment on, and watch his posts and videos, vote on live polls, and get notified when he goes live or posts.

## What it does
Connect once with "Connect with Kick," then earn tickets in Mizkif's game by engaging
with his content:
- **Like / comment / watch** his promoted posts and videos on X, YouTube, TikTok, and
  Instagram — a small card appears on the post and credits the action.
- **Vote** on live polls from his Kick stream (an on-stream card, plus a pop-out window
  when you're on another tab).
- **Notifications** when he goes live or posts (no login required for these).
The popup and the on-install welcome page show a live "How to earn" list.

## Permissions justification (for review)
- **identity** — the one-time "Connect with Kick" login (launchWebAuthFlow).
- **storage** — stores the member's auth token and small local state.
- **alarms** — a periodic timer to check for open polls and new content.
- **notifications** — desktop alerts when a poll opens or Mizkif goes live / posts.
- **host: https://s2.jsolutions.dev/** — the game API (connect, engagement, votes, watch, rates).
- **host: https://rinaudoglobal.com/** — the public status feed that powers notifications (no login).
- **host: https://kick.com/** — show the vote card on Mizkif's channel page.
- **host: https://x.com/, https://twitter.com/, https://www.youtube.com/, https://www.tiktok.com/, https://www.instagram.com/**
  — detect and credit the member's likes / comments / watches on Mizkif's promoted posts and videos.

## Data handling
- No analytics, no third-party sharing, no tracking, no ads.
- Stored locally: the member's revocable auth token + small bookkeeping (last poll/video/post
  shown, on-page card position).
- Network calls go only to `s2.jsolutions.dev` (the game API) and `rinaudoglobal.com` (the public
  notifications feed).
- Content scripts run only on Mizkif's Kick channel and on X / YouTube / TikTok / Instagram post
  pages, only to detect the member's own deliberate engagement and show the extension's own card.
  They do not read or collect page content; comment text is checked locally for length only and is
  never transmitted.
- Firefox (AMO): `data_collection_permissions` declared in `manifest.firefox.json`.

## Before submitting
- Host `privacy.html` at a public URL and put it in the listing's privacy field.
- Confirm the host permissions list matches `manifest.json` (8 hosts).
- Bump `version` in both `manifest.json` and `manifest.firefox.json`.
- Note: TikTok/Instagram engagement requires the matching backend support to be live to credit.
