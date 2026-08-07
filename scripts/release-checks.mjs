#!/usr/bin/env node
// Release gate for the Mizkif Global browser extension.
// Zero npm dependencies; shells out only to `node --check` and `unzip`.
//
// Modes:
//   node scripts/release-checks.mjs
//       Run the source-tree checks (manifests, syntax, dash policy, host coverage).
//   node scripts/release-checks.mjs --zips <chrome.zip> <firefox.zip>
//       Run the post-build zip checks (version match, gecko id placement,
//       content/instagram.js present inside each archive).
//
// Exit code 0 = everything passed, 1 = at least one failure (each failure is printed).
//
// Why this exists: releases used to be hand-rolled (manual copies, sed bumps,
// ad-hoc zips) and manifest host coverage drifted between the Chrome and
// Firefox manifests — Instagram content scripts silently never loaded in
// production. Every rule below encodes one of those failure modes.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The packaged file set. Must stay in lockstep with SHARED in build.sh.
const PACKAGED_DIRS = ['content', 'popup', 'vote', 'icons'];
const PACKAGED_TOP_JS = ['config.js', 'background.js', 'rates-list.js', 'welcome.js'];
const PACKAGED_TOP_HTML = ['welcome.html', 'privacy.html'];

// A line containing this marker is exempt from the dash check (for the rare
// false positive, e.g. a dash inside a tricky quoted string in code).
const DASH_OK_MARKER = 'dash-ok';
const DASH_RE = /[–—]/; // en dash, em dash

const failures = [];
function fail(check, msg) { failures.push(`[${check}] ${msg}`); }
function ok(check, msg) { console.log(`  ok  ${check}: ${msg}`); }

function listByExt(dir, ext) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter(f => f.endsWith(ext)).map(f => path.join(dir, f));
}

function packagedJsFiles() {
  const files = [...PACKAGED_TOP_JS];
  for (const d of PACKAGED_DIRS) files.push(...listByExt(d, '.js'));
  return files;
}
function packagedHtmlFiles() {
  const files = [...PACKAGED_TOP_HTML];
  for (const d of PACKAGED_DIRS) files.push(...listByExt(d, '.html'));
  return files;
}

function readJson(rel) {
  const raw = readFileSync(path.join(ROOT, rel), 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Check 1 + 2: manifests parse, versions agree, gecko id on the right side
// ---------------------------------------------------------------------------
function checkManifests() {
  let chrome = null, firefox = null;
  try { chrome = readJson('manifest.json'); }
  catch (e) { fail('manifest-json', `manifest.json failed to parse: ${e.message}`); }
  try { firefox = readJson('manifest.firefox.json'); }
  catch (e) { fail('manifest-json', `manifest.firefox.json failed to parse: ${e.message}`); }
  if (!chrome || !firefox) return null;
  ok('manifest-json', 'both manifests parse');

  if (chrome.version !== firefox.version) {
    fail('version-sync', `version mismatch: chrome=${chrome.version} firefox=${firefox.version}`);
  } else {
    ok('version-sync', `both manifests at ${chrome.version}`);
  }

  const ffGecko = firefox.browser_specific_settings?.gecko?.id;
  const crGecko = chrome.browser_specific_settings?.gecko?.id;
  if (!ffGecko) fail('gecko-id', 'manifest.firefox.json is missing browser_specific_settings.gecko.id');
  if (crGecko) fail('gecko-id', `manifest.json (chrome) must NOT carry a gecko id, found ${crGecko}`);
  if (ffGecko && !crGecko) ok('gecko-id', `firefox has ${ffGecko}, chrome has none`);

  return { chrome, firefox };
}

// ---------------------------------------------------------------------------
// Check 3: every packaged .js passes `node --check`
// ---------------------------------------------------------------------------
function checkSyntax() {
  let bad = 0;
  for (const rel of packagedJsFiles()) {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, rel)], { encoding: 'utf8' });
    if (r.status !== 0) {
      bad++;
      fail('js-syntax', `${rel} failed node --check:\n${(r.stderr || '').trim()}`);
    }
  }
  if (!bad) ok('js-syntax', `${packagedJsFiles().length} packaged .js files parse`);
}

// ---------------------------------------------------------------------------
// Check 4: no em/en dashes in user-facing places.
//   .js  : dashes are allowed only in comments. Heuristic: a line whose trimmed
//          form starts with // or * is a comment; otherwise we strip comment
//          spans with a quote-aware scanner (stripLineComments below) and flag
//          any dash left over. Tricky false positives can be silenced by
//          putting the marker "dash-ok" on the line.
//   .html: a dash ANYWHERE fails, comments included.
// ---------------------------------------------------------------------------

// Remove comment spans from one line of JS while respecting string literals,
// so a // inside a quoted string (e.g. 'see https://x.com // note') never
// swallows the rest of the line. Rules:
//   - inside ' " or ` : nothing starts a comment; backslash escapes are honored
//   - /* ... */ outside a string is replaced with a space (unterminated on the
//     line -> the rest of the line is comment)
//   - // outside a string starts a trailing comment, but only at line start or
//     after whitespace (keeps protocol-relative tokens and regex literals from
//     being eaten; a missed strip is only ever a silenceable false positive)
// Multi-line block comment bodies are handled by the leading * heuristic in
// checkDashes, same as before.
function stripLineComments(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += line[i + 1] ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      out += ' ';
      if (end === -1) return out; // block comment runs to end of line
      i = end + 1;
      continue;
    }
    if (c === '/' && line[i + 1] === '/' && (i === 0 || /\s/.test(line[i - 1]))) {
      return out; // trailing // comment
    }
    out += c;
  }
  return out;
}

function checkDashes() {
  let bad = 0;
  for (const rel of packagedJsFiles()) {
    const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!DASH_RE.test(line)) return;
      if (line.includes(DASH_OK_MARKER)) return;
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      const code = stripLineComments(line);
      if (DASH_RE.test(code)) {
        bad++;
        fail('no-dashes', `${rel}:${i + 1} em/en dash outside a comment: ${trimmed.slice(0, 100)}`);
      }
    });
  }
  for (const rel of packagedHtmlFiles()) {
    const lines = readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (DASH_RE.test(line)) {
        bad++;
        fail('no-dashes', `${rel}:${i + 1} em/en dash in HTML (forbidden anywhere): ${line.trim().slice(0, 100)}`);
      }
    });
  }
  if (!bad) ok('no-dashes', 'no em/en dashes outside comments in .js, none at all in .html');
}

// ---------------------------------------------------------------------------
// Check 5: manifest host coverage.
//   - content_scripts match sets identical between manifests
//   - host_permissions sets identical between manifests
//   - union includes the three Instagram patterns (the exact gap that shipped
//     broken in production)
//   - union covers the host of every API: origin declared in config.js
// ---------------------------------------------------------------------------
const REQUIRED_PATTERNS = [
  'https://www.instagram.com/*',
  'https://instagram.com/*',
  'https://instagr.am/*',
];

function contentMatches(manifest) {
  return (manifest.content_scripts || []).flatMap(cs => cs.matches || []);
}

function setDiff(a, b) {
  const A = new Set(a), B = new Set(b);
  return {
    onlyA: [...A].filter(x => !B.has(x)),
    onlyB: [...B].filter(x => !A.has(x)),
  };
}

function patternHost(pattern) {
  const m = /^(\*|https?|wss?):\/\/([^/]+)\//.exec(pattern);
  return m ? m[2].toLowerCase() : null;
}

function hostCovered(host, patterns) {
  return patterns.some(p => {
    const h = patternHost(p);
    if (!h) return false;
    if (h === '*' || h === host) return true;
    if (h.startsWith('*.')) {
      const base = h.slice(2);
      return host === base || host.endsWith('.' + base);
    }
    return false;
  });
}

function apiHostsFromConfig() {
  const src = readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  const hosts = new Set();
  const re = /\bAPI:\s*(['"])([^'"]+)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    try { hosts.add(new URL(m[2]).hostname.toLowerCase()); }
    catch { fail('host-coverage', `config.js API value is not a valid URL: ${m[2]}`); }
  }
  return [...hosts];
}

function checkHostCoverage(chrome, firefox) {
  let bad = 0;
  const report = (label, d) => {
    if (d.onlyA.length || d.onlyB.length) {
      bad++;
      if (d.onlyA.length) fail('host-coverage', `${label}: only in chrome manifest: ${d.onlyA.join(', ')}`);
      if (d.onlyB.length) fail('host-coverage', `${label}: only in firefox manifest: ${d.onlyB.join(', ')}`);
    }
  };
  report('content_scripts matches', setDiff(contentMatches(chrome), contentMatches(firefox)));
  report('host_permissions', setDiff(chrome.host_permissions || [], firefox.host_permissions || []));

  const union = new Set([
    ...contentMatches(chrome), ...(chrome.host_permissions || []),
    ...contentMatches(firefox), ...(firefox.host_permissions || []),
  ]);
  for (const p of REQUIRED_PATTERNS) {
    if (!union.has(p)) { bad++; fail('host-coverage', `required Instagram pattern missing from both manifests: ${p}`); }
  }
  const apiHosts = apiHostsFromConfig();
  if (apiHosts.length === 0) { bad++; fail('host-coverage', 'no API: origins found in config.js (parser broken or config changed shape)'); }
  for (const host of apiHosts) {
    if (!hostCovered(host, [...union])) { bad++; fail('host-coverage', `config.js API host ${host} is not covered by any manifest pattern`); }
  }
  if (!bad) ok('host-coverage', `manifests identical; Instagram patterns present; API hosts covered (${apiHosts.join(', ')})`);
}

// ---------------------------------------------------------------------------
// Check 6 (--zips mode): verify inside the built archives
// ---------------------------------------------------------------------------
function zipEntryNames(zipPath) {
  const r = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`unzip -Z1 ${zipPath} failed: ${(r.stderr || '').trim()}`);
  return r.stdout.split('\n').filter(Boolean);
}

function zipReadFile(zipPath, entry) {
  const r = spawnSync('unzip', ['-p', zipPath, entry], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`unzip -p ${zipPath} ${entry} failed: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

function checkZips(chromeZip, firefoxZip) {
  let srcVersion = null;
  try {
    const chrome = readJson('manifest.json');
    const firefox = readJson('manifest.firefox.json');
    if (chrome.version !== firefox.version) fail('zip-verify', `source manifests disagree on version (${chrome.version} vs ${firefox.version})`);
    srcVersion = chrome.version;
  } catch (e) {
    fail('zip-verify', `could not read source manifests: ${e.message}`);
    return;
  }

  for (const [label, zipPath, wantGecko] of [['chrome', chromeZip, false], ['firefox', firefoxZip, true]]) {
    if (!existsSync(zipPath)) { fail('zip-verify', `${label} zip not found: ${zipPath}`); continue; }
    let names, manifest;
    try {
      names = zipEntryNames(zipPath);
      manifest = JSON.parse(zipReadFile(zipPath, 'manifest.json'));
    } catch (e) {
      fail('zip-verify', `${label}: ${e.message}`);
      continue;
    }
    let bad = 0;
    if (!names.includes('manifest.json')) { bad++; fail('zip-verify', `${label}: no manifest.json at zip root`); }
    if (manifest.version !== srcVersion) { bad++; fail('zip-verify', `${label}: zip manifest version ${manifest.version} does not match source ${srcVersion}`); }
    const gecko = manifest.browser_specific_settings?.gecko?.id;
    if (wantGecko && !gecko) { bad++; fail('zip-verify', `${label}: zip manifest is missing the gecko id`); }
    if (!wantGecko && gecko) { bad++; fail('zip-verify', `${label}: zip manifest must NOT carry a gecko id, found ${gecko}`); }
    if (!names.includes('content/instagram.js')) { bad++; fail('zip-verify', `${label}: content/instagram.js is MISSING from the zip`); }
    const dsStore = names.filter(n => n.split('/').pop() === '.DS_Store');
    if (dsStore.length) { bad++; fail('zip-verify', `${label}: .DS_Store leaked into the zip: ${dsStore.join(', ')}`); }
    if (!bad) ok('zip-verify', `${path.basename(zipPath)}: v${manifest.version}, gecko id ${wantGecko ? 'present' : 'absent'}, content/instagram.js present, ${names.length} entries`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
if (args[0] === '--zips') {
  const [chromeZip, firefoxZip] = args.slice(1);
  if (!chromeZip || !firefoxZip) {
    console.error('usage: release-checks.mjs --zips <chrome.zip> <firefox.zip>');
    process.exit(2);
  }
  console.log('Release checks (built zips):');
  checkZips(path.resolve(chromeZip), path.resolve(firefoxZip));
} else if (args.length > 0) {
  console.error(`unknown argument: ${args[0]}\nusage: release-checks.mjs [--zips <chrome.zip> <firefox.zip>]`);
  process.exit(2);
} else {
  console.log('Release checks (source tree):');
  const manifests = checkManifests();
  checkSyntax();
  checkDashes();
  if (manifests) checkHostCoverage(manifests.chrome, manifests.firefox);
}

if (failures.length) {
  console.error(`\nFAILED, ${failures.length} problem${failures.length === 1 ? '' : 's'}:`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('All checks passed.');
