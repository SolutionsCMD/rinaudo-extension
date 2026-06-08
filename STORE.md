# Chrome Web Store listing notes

**Name:** Rinaudo Capital — Live Votes
**Summary:** Vote on Mizkif's live stock picks from the stream, and get a notification the moment a poll opens.

## What it does
When the Rinaudo Capital desk opens a poll, members watching Mizkif's Kick stream
see a vote card on the page and can vote in one tap; if they're on another tab,
they get a desktop notification to come back. Votes are credited to their Rinaudo
account, which they link once with "Connect with Kick."

## Permissions justification (for review)
- **identity** — the one-time "Connect with Kick" login (launchWebAuthFlow).
- **storage** — stores the member's auth token locally.
- **alarms** — a 30s timer to check whether a poll is open (off-stream alerts).
- **notifications** — desktop alert when a poll opens and the member isn't on the stream.
- **host: https://kick.com/** — inject the vote card ONLY on Mizkif's channel page.
- **host: https://rinaudoglobal.com/** — call the Rinaudo poll + auth APIs.

## Data handling
- No analytics, no third-party sharing, no tracking.
- The only stored value is the member's own revocable auth token.
- The content script runs only on `https://kick.com/mizkif*` and only injects its
  own vote card — it does not read Kick page content.
- Network calls go only to `https://rinaudoglobal.com`.

## Before submitting
- Replace `icons/icon128.png` (and add 48/16) with final brand art.
- Confirm Mizkif's exact Kick channel slug in `manifest.json` + `config.js`.
- Bump `version` in `manifest.json`.
