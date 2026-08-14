# Safari: the runbook

Why this exists: Safari is 10.1% of traffic on the public lander and 0.6% on the desk.
The extension is the wall. Of the Safari visitors who reach the front door, 31 of 33 are
on an iPhone, so this is an iPhone problem wearing a Safari label.

Safari extensions cannot be shipped as a zip. They must be wrapped in a native app,
built with Xcode, distributed through the App Store. That is Apple's rule and there is no
way around it. What follows is how that gets done by people who own no Mac.

---

## What is already built and provable today

- `manifest.safari.json`, a third target beside Chrome and Firefox, produced by the same
  `./build.sh` and held to the same `scripts/release-checks.mjs` gate.
- `.github/workflows/safari.yml`, which converts and builds the wrapper on GitHub's macOS
  runners. Free, because this repo is public.
- The unsigned lane needs **no Apple account**. Push, open Actions, read the log.

Run it now:

```bash
gh workflow run safari.yml     # or press "Run workflow" in the Actions tab
```

The job summary lists every manifest key Safari ignored. Read that list before anything
else; it is the porting bug list, and it is why the step exists.

## What costs money, and what does not

| Thing | Cost | Needed for |
|---|---|---|
| GitHub macOS runners | free (public repo) | building the app |
| Apple Developer Program | **$99/year** | signing, TestFlight, the App Store |
| Cloud Mac (Scaleway hourly, MacinCloud monthly) | ~$5/day, only if needed | interactive debugging CI cannot explain |

There is no free distribution path. Even shipping outside the App Store on macOS needs a
paid account for notarization, and iOS has no route but the App Store. Since iPhone is
the audience, the $99 is the price of the feature.

## Decisions before the account is created

1. **Individual or Organization.** Individual enrolls in about two days but the store
   listing shows a PERSON'S LEGAL NAME as the seller, publicly and permanently. An
   Organization listing shows the company but needs a D-U-N-S number and takes longer.
   The brand is "Mizkif Global", so decide whose name the public sees.
2. **A test iPhone and a person holding it.** TestFlight needs a real device. A trusted
   mod works. They install TestFlight and accept an email invite; they need no Mac.
3. **The app name.** App Store names are globally unique. Have a fallback
   ("Mizkif Global Tickets") ready.

## Getting a signing certificate without a Mac

The usual instructions say to use Keychain Access. You do not need it. A certificate
signing request is just a keypair plus a form, and openssl makes both on Linux.

```bash
# 1. private key + CSR (answer the prompts; Common Name = the Apple account name)
openssl genrsa -out ios_distribution.key 2048
openssl req -new -key ios_distribution.key -out ios_distribution.csr

# 2. upload the .csr at developer.apple.com -> Certificates -> +
#    type: "Apple Distribution". download the resulting ios_distribution.cer

# 3. turn Apple's DER certificate + your key into the .p12 CI wants
openssl x509 -in ios_distribution.cer -inform DER -out ios_distribution.pem -outform PEM
openssl pkcs12 -export -inkey ios_distribution.key -in ios_distribution.pem \
  -out ios_distribution.p12 -passout pass:CHOOSE_A_PASSWORD

# 4. base64 it for the GitHub secret
base64 -w0 ios_distribution.p12 > ios_distribution.p12.b64
```

Keep `ios_distribution.key` and the `.p12` out of the repo. They are the keys to
publishing under this name.

## Repository secrets

Add under Settings -> Secrets and variables -> Actions. The signed lane stays dormant
until `ASC_KEY_ID` exists, so add that one last.

| Secret | Where it comes from |
|---|---|
| `CERT_P12` | contents of `ios_distribution.p12.b64` |
| `CERT_PASSWORD` | the password chosen in step 3 |
| `APPLE_TEAM_ID` | developer.apple.com -> Membership |
| `ASC_ISSUER_ID` | App Store Connect -> Users and Access -> Integrations -> Keys |
| `ASC_KEY_P8` | the downloaded `AuthKey_XXXX.p8`, base64'd (`base64 -w0`) |
| `ASC_KEY_ID` | the key id shown beside it. **Add last**, it arms the lane |

Apple lets you download a `.p8` key exactly once. Store it somewhere durable.

## Releasing

```bash
./build.sh --set-version 1.127
./build.sh
git commit -am "1.127: ..." && git tag v1.127 && git push --tags
```

The tag runs the signed lane and a build lands in TestFlight. Chrome and Firefox are
still submitted by hand, unchanged.

Safari trails the other two by a review cycle (usually about a day). That is fine: the
backend already supports old clients, with members still running 1.0.59.

## Test matrix (paste to the TestFlight testers)

- [ ] Install from TestFlight, open the app, follow the enable screen
- [ ] Safari asks for site permission: choose **Always Allow on Every Website**
- [ ] Connect to your account from the popup, and the desk shows you as connected
- [ ] Watch a YouTube target from the Earn page: tickets land
- [ ] Like and comment on a post: both credit
- [ ] **Repost on X**: credits. The one Safari-specific risk, because it needs the
      MAIN-world observer. Requires Safari 18 / iOS 18 or newer. Check the tester's iOS
      version FIRST: on 17 or older this is expected to fail and proves nothing
- [ ] kick.com/mizkif shows the widget and the stake panel
- [ ] Popup shows the right ticket count and rates

## Known limits, to be said out loud rather than discovered

- **`world: "MAIN"` works from Safari 18 / iOS 18.** Apple's converter warns that `world`
  is "not supported by your current version of Safari" on BOTH Xcode 15.4 and 16.4, which
  looked like a blocker for the MAIN-world observer that carries half of two-signal repost
  crediting. It is a false alarm: the converter checks against an older baseline, not
  against shipping Safari. MDN's browser-compat-data records `content_scripts.world` as
  `version_added: "18"` for Safari, mirrored on iOS (Chrome 111, Firefox 128 for
  comparison). Treat the converter's list as "read and check", not as truth.

  **Consequence for the app: set the deployment target to iOS 18 / macOS 15** (September
  2024), not the 17.4 the plan first assumed. Below 18 the observer would not run and
  reposts and shares would silently stop crediting, so the App Store gate is what keeps
  a half-working build off older devices. No code change is needed and the observer stays
  exactly as it is on all three browsers.

  If a real device ever shows reposts failing on Safari 18+, the pre-`world` fallback is
  to inject `observe.js` via a `<script src=chrome.runtime.getURL(...)>` tag from an
  isolated content script, with the file added to `web_accessible_resources`. Written
  down in case it is needed; it should not be.
- **No go-live notifications.** Safari has no `notifications` API. The `HAS_NOTIFICATIONS`
  guard (background.js:17) already handles it, so nothing breaks; the pings just never
  fire. Say so on the downloads card. Discord remains the alert channel.
- **Per-site permission is per DOMAIN on iOS.** A member who taps "Allow for One Day" on
  youtube.com only earns on youtube.com, until it lapses. This is the single biggest
  conversion risk and both the onboarding screen and the downloads card must address it.
- **In-app viewing is invisible.** Watching in the YouTube, TikTok or Instagram apps
  cannot be credited by any extension on any platform. iPhone members must browse those
  sites inside Safari, exactly as the Firefox Android members are told to use Firefox.
