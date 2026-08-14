# Safari Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (Session pattern: plan on Fable, execution on Opus, inline. Tasks 1, 2 and 6 run from this Linux box; Tasks 3-5 run through GitHub Actions and App Store Connect in a browser.)

**Goal:** The Mizkif Global extension installs from the App Store and earns tickets on Safari, macOS and iPhone both — because right now Apple users are effectively barred: Safari is 10.1% of lander traffic but 0.6% of desk traffic, a ~17x collapse exactly where the extension becomes mandatory.

**Architecture:** One webextension source, three targets. Safari joins Chrome and Firefox through the same pattern those two already use: a per-browser manifest swapped in by `build.sh`, gated by `scripts/release-checks.mjs`. The Mac problem is solved by GitHub Actions: macOS runners with Xcode are free on public repos, and this repo is public. Apple's `safari-web-extension-converter` wraps the webextension in the required native app; CI builds and (once signing exists) uploads it. No Mac is ever owned; a ~$5/day cloud Mac is rented only for interactive debugging sessions.

**Tech Stack:** Existing vanilla-JS webextension (MV3), `xcrun safari-web-extension-converter`, `xcodebuild`, GitHub Actions `macos-15` runners, TestFlight, App Store Connect.

---

## Verified facts (2026-08-14, do not re-derive)

- **Traffic:** lander 10.1% Safari (31 of 33 hits iPhone), desk 0.6%. The wall is real and it is mostly iPhone.
- **API surface is Safari-clean.** No `webRequest`, `declarativeNetRequest`, `scripting`, `offscreen`. Uses `storage.local` (104 calls), `alarms`, `tabs`, `notifications`, `windows`. The two APIs Safari lacks or restricts are ALREADY feature-detected because Firefox Android forced it: `HAS_NOTIFICATIONS` (background.js:17, guards creates AND listener registration at :483) and `HAS_WINDOWS` (:295). The connect flow deliberately avoids `chrome.identity` (background.js:67-68, unsupported on Firefox Android) — which Safari also benefits from. `sendBeacon` interception for mobile web exists (observe.js:295).
- **`world: "MAIN"` needs Safari 18 / iOS 18** (September 2024), per MDN browser-compat-data (`content_scripts.world`: safari 18, safari_ios mirror; chrome 111, firefox 128). NOT 17.4, which this plan originally said. Apple's `safari-web-extension-converter` warns that `world` is unsupported on both Xcode 15.4 and 16.4 — verified in CI, and it is a stale baseline check, not the runtime truth. `content/observe.js` (the platform-confirmed half of two-signal repost/share crediting) runs there, so the deployment target is the guard: iOS 18 / macOS 15, no code change, anti-fraud identical on all three browsers.
- **Two-target precedent:** `manifest.json` (Chrome) vs `manifest.firefox.json` differ only in background mechanism (`service_worker` vs `scripts: [config.js, background.js]`), the gecko id block, `minimum_chrome_version`, and `update_url`. `build.sh` packages SHARED files + the right manifest; `release-checks.mjs` exists because the two manifests once drifted and Instagram silently broke. Safari must join this gate, not bypass it.
- **Repo:** public, `SolutionsCMD/rinaudo-extension`, no `.github/workflows` yet. Public repo ⇒ free macOS Actions minutes; repository secrets are NOT exposed to fork PRs (do not use `pull_request_target`).
- **Owner constraints:** no Mac, no Apple Developer account. $99/year program is unavoidable (App Store is the only Safari distribution channel that covers iOS; macOS-only notarized distribution also requires the paid program, so there is no free path).
- **Content scripts hit the same sites with the same DOMs** in Safari; the porting risk is in extension APIs, the iOS permission-prompt UX, and the store process — not in the selectors.
- **Version skew is already survivable:** members on 1.0.59 still work against the backend, so Safari lagging Chrome by a review cycle breaks nothing.

## Decisions the owner makes before Task 3 can finish (nothing else blocks on them)

1. **Apple account type.** Individual ($99, ships fast, but the App Store listing shows a PERSON's legal name as the developer) vs Organization (needs a D-U-N-S number for the company, takes longer, listing shows the company). Given the brand is "Mizkif Global", decide whose name appears. Enrollment: developer.apple.com/programs/enroll, roughly 2 days for individual.
2. **A test iPhone.** TestFlight needs a real device and a person. A trusted mod works; they install the TestFlight app and accept an email invite. No Mac needed on their side.
3. **App name** on the store: "Mizkif Global" (must be globally unique on the App Store; have "Mizkif Global Tickets" as the fallback).

## File map

| File | Role |
|---|---|
| `manifest.safari.json` (new) | Third manifest, Chrome-derived, Safari-clean. |
| `build.sh` (modify) | Third zip: `rinaudo-extension-safari.zip` (converter input). |
| `scripts/release-checks.mjs` (modify) | Safari manifest joins every drift check. |
| `.github/workflows/safari.yml` (new) | macOS runner: convert → build → artifact; signed lane behind secrets. |
| `safari/onboarding.md` (new) | Copy + spec for the wrapper app's one screen (Xcode project consumes it). |
| `docs/SAFARI.md` (new) | The whole operational runbook: signing, TestFlight, review, release. |
| `STORE.md` (modify) | Safari section: listing copy, privacy answers, review notes. |
| Portal `/downloads` (modify, portal repo) | Safari card behind a `safari_live` app_config flag. |

---

## Task 1: Source-side portability (all on this box, blocks on nothing)

**Files:** Create `manifest.safari.json`; modify `build.sh`, `scripts/release-checks.mjs`

- [x] **Step 1: Write `manifest.safari.json`.** Start from `manifest.json` and apply exactly these deltas (this is the whole diff, mirroring how the Firefox manifest differs):
  - Drop `update_url` (Chrome-only) and `minimum_chrome_version`.
  - Keep `manifest_version: 3` and the `background.service_worker` form (Safari 16.4+ supports it; our floor is 18). If the first CI build logs a converter warning that the worker failed to register, switch to the Firefox-style `background.scripts: ["config.js", "background.js"]` — that alternative is already proven in this codebase.
  - Everything else byte-identical: permissions, host_permissions, all seven content_script blocks INCLUDING the `world: "MAIN"` observe.js block (Safari 18+ supports MAIN world).
- [x] **Step 2: Wire the third target into `build.sh`.** `SAFARI_ZIP="rinaudo-extension-safari.zip"`, packaged from the same `SHARED` set with `manifest.safari.json` renamed to `manifest.json` inside the zip — the same mechanism the Firefox zip uses. `--set-version` updates all THREE manifests.
- [x] **Step 3: Extend `release-checks.mjs`.** Every check that today compares Chrome↔Firefox now runs across all three: version equality, host-permission coverage, content-script file lists (the Instagram-never-loaded failure class), dash policy, `node --check` syntax. Add two Safari-specific rules: `update_url` must NOT appear in the Safari manifest, and the MAIN-world block MUST appear (losing it would silently kill repost crediting on the one browser nobody tests by hand).
- [x] **Step 4: Chrome-namespace promise audit.** Safari supports the `chrome.*` alias with promises, but grep for the two patterns that bite: callback-style `chrome.storage.local.get(key, cb)` mixed with awaited calls, and any `chrome.runtime.lastError` checks that assume callbacks. Emit a list; convert stragglers to the awaited form (the codebase is already predominantly `await chrome.…`).
- [x] **Step 5:** `./build.sh` produces three zips, checks green. Commit: `safari: third build target, same source, same gate`.

## Task 2: CI — the Mac we do not own

**Files:** Create `.github/workflows/safari.yml`

- [ ] **Step 1: Unsigned-build workflow first** (proves the whole chain with zero Apple account):

```yaml
name: safari
on:
  push:
    tags: ['v*']
  workflow_dispatch: {}
jobs:
  build:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
      - name: Build the webextension zip set
        run: ./build.sh
      - name: Convert to a Safari app project
        run: |
          mkdir -p safari-build && cd safari-build
          unzip -q ../rinaudo-extension-safari.zip -d webext
          xcrun safari-web-extension-converter webext \
            --project-location . --app-name "Mizkif Global" \
            --bundle-identifier dev.jsolutions.mizkifglobal \
            --macos-only --no-open --no-prompt --force
      - name: Build (unsigned)
        run: |
          cd "safari-build/Mizkif Global"
          xcodebuild -scheme "Mizkif Global (macOS)" \
            CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO build
      - uses: actions/upload-artifact@v4
        with: { name: safari-app-unsigned, path: safari-build }
```

  The first run IS the test of the converter flags and scheme names — expect to adjust the scheme string from the run log (`xcodebuild -list` in a debug step prints the real ones). `--macos-only` keeps round one simple; the iOS target is added in Step 3 by dropping that flag.
- [ ] **Step 2: Iterate on CI until green.** Read every converter warning in the log — it names each manifest key Safari ignores. Anything load-bearing that is ignored goes back into Task 1 as a code change, not a shrug.
- [ ] **Step 3: Add iOS.** Remove `--macos-only`; build both schemes; artifacts for both. The iOS build stays unsigned until Task 4.
- [ ] **Step 4: Signed lane, gated on secrets existing** (`if: ${{ secrets.ASC_KEY_ID != '' }}`): import the distribution certificate + provisioning profiles (`apple-actions/import-codesign-certs`), `xcodebuild archive` + `-exportArchive` with an App Store export plist, upload with `xcrun altool`'s successor per current Xcode (or fastlane `pilot`, the boring standard). This lane is WRITTEN now and lights up the day the account exists.
- [ ] **Step 5:** Commit workflow + a `docs/SAFARI.md` skeleton recording every discovered quirk.

## Task 3: The wrapper app is a real (tiny) app

**Files:** `safari/onboarding.md` (spec + copy), applied to the Xcode project via a scripted patch step in the workflow (the converter regenerates the project each build, so customisations must be applied by script, never by hand-editing a checked-in project)

- [ ] **Step 1: One onboarding screen** (SwiftUI, ~40 lines, patched into the generated project by a `sed`/file-copy step in the workflow): the mark, one sentence, an "Open Safari Settings" button (`SFSafariApplication.showPreferencesForExtension` on macOS; on iOS a static illustration of Settings → Apps → Safari → Extensions), and a link to mizkif.com. Copy (no dashes, plain voice):

  > **Turn it on in Safari**
  > This app installs the Mizkif Global extension. Safari keeps extensions off until you enable them, so flip it on and allow it on every website. That is what lets tickets count when you like, comment and watch.

- [ ] **Step 2: Per-site permissions are the conversion killer on iOS** — Safari asks per DOMAIN. The onboarding screen and the /downloads Safari card must both say: choose "Always Allow on Every Website" when Safari asks, or tickets only count on sites you approved. Write both copies now.
- [ ] **Step 3: App Review prep, in `STORE.md`:** App Privacy answers derived from `privacy.html` (identifier: Kick username; usage data: engagement events; no tracking across apps — matches the existing policy); review notes explaining WHY every-site access is needed (crediting happens on five social platforms, list them); the guideline-4.4 justification that the app's function is the extension plus setup. Include a demo Kick account for the reviewer.

## Task 4: Signing, TestFlight, and the two owner purchases

**Owner actions with exact clicks, in `docs/SAFARI.md`:**

- [ ] **Step 1:** Enroll (decision 1). Record the Team ID.
- [ ] **Step 2:** App Store Connect: create the app record (name from decision 3, bundle id `dev.jsolutions.mizkifglobal` + `.extension`), generate an App Store Connect API key, add these repo secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `CERT_P12`, `CERT_PASSWORD`. (Certificate creation without a Mac: generate the CSR with openssl on THIS box — the exact three commands go in SAFARI.md — upload it in the developer portal, download the cert, assemble the p12 with openssl. No Mac required at any step.)
- [ ] **Step 3:** Tag a release; the signed lane uploads build 1 to TestFlight. Invite the test iPhone owner (decision 2) and at least one Mac-owning mod.
- [ ] **Step 4:** Rent the debug Mac ONLY if TestFlight surfaces bugs CI cannot explain: Scaleway Apple silicon (hourly, 24h minimum, under €6/day) or MacinCloud (~$30/month), screen-shared from here. Budget assumption: one to three days total.

## Task 5: Validation checklist, then submission

- [ ] **Step 1: The test matrix** (run by the TestFlight testers, written as a paste-ready Discord checklist in SAFARI.md): connect flow end to end (the `/extension/connect` content script + same-origin POST — watch Safari ITP here, though same-origin should pass); watch crediting on a YouTube target; like + comment crediting; repost two-signal on X (this exercises the MAIN-world observer — THE Safari-specific risk); the Kick widget + stake panel on kick.com; popup opens and reflects state; per-site permission flow on iOS matches the onboarding copy.
- [ ] **Step 2:** Fix loop through CI builds (each TestFlight build is minutes of CI, no humans in the middle).
- [ ] **Step 3:** Screenshots (macOS from the rented Mac or a mod; iOS from the tester), submit for review with the STORE.md notes. Expect one rejection round on first submission of an every-site extension; the prepared review notes exist to make it short.

## Task 6: Ship it to members (portal repo, this box)

- [ ] **Step 1:** `/downloads` gains a Safari / iPhone card, gated on a new `app_config` key `safari_live` holding the App Store URL (same pattern as `downloads_live`), so the page changes the moment approval lands and not before. Card copy carries the enable-in-Settings and allow-every-website instructions.
- [ ] **Step 2:** The Earn page's extension CTAs and the lander note (owner's copy — flag, do not edit) stay as they are; add the App Store link to the portal card only.
- [ ] **Step 3:** Extension telemetry: confirm `ext_debug_log` records a platform/UA field distinguishing Safari (it records UA today; verify, add a note if not) so Safari-specific breakage is visible in the Office.
- [ ] **Step 4:** Announce in Discord after a week of quiet telemetry, not on day one.

## Standing costs and the honest caveats (goes in the final report and SAFARI.md)

- $99/year, plus under ~$20 of one-time cloud-Mac hours. CI is free.
- Every Safari release passes App Store review (typically about a day). Safari will trail Chrome/Firefox by that lag; the backend already tolerates version skew.
- Safari 17.4+ only (iOS 17.4 / macOS 14.4), which keeps repost anti-fraud intact everywhere. Older devices see the App Store's own "requires iOS 17.4" gate.
- No go-live notification toasts on Safari (`HAS_NOTIFICATIONS` guard simply stays false). The pings members rely on remain a Chrome/Firefox/Discord feature; say so on the card.
- iPhone reality: crediting works in Safari the browser. Watching inside the YouTube/TikTok/Instagram APPS is invisible to any extension on any platform. The card copy must repeat the same "browse the sites inside Safari" line the Firefox mobile story uses.
