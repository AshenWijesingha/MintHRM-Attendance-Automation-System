#!/usr/bin/env node
/**
 * Pre-package checks for the MintHRM Attendance Automation System extension.
 *
 *  - manifest.json parses and has the required Manifest V3 fields
 *  - every file the manifest (and popup.html) references exists
 *  - icons are real PNGs with the declared pixel size
 *  - every JavaScript file passes a syntax check
 *
 * Usage:  node scripts/validate.mjs        (exit code 0 = OK, 1 = problems found)
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { errors.push(msg); console.log(`  ✗ ${msg}`); };

console.log('Validating extension…');

// ---- manifest -------------------------------------------------------------
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  ok('manifest.json is valid JSON');
} catch (e) {
  fail(`manifest.json cannot be parsed: ${e.message}`);
  process.exit(1);
}

if (manifest.manifest_version === 3) ok('Manifest V3'); else fail('manifest_version must be 3');
for (const key of ['name', 'version', 'description']) {
  if (manifest[key]) ok(`"${key}" present`); else fail(`"${key}" is missing`);
}
if (/^\d+(\.\d+){0,3}$/.test(manifest.version || '')) ok(`version ${manifest.version} is a valid Chrome version string`);
else fail(`version "${manifest.version}" must be 1-4 dot-separated integers`);
if ((manifest.name || '').length <= 75) ok('name ≤ 75 characters'); else fail('name is longer than 75 characters');
if ((manifest.short_name || '').length <= 12) ok('short_name ≤ 12 characters'); else fail('short_name is longer than 12 characters');
if ((manifest.description || '').length <= 132) ok('description ≤ 132 characters (Chrome Web Store limit)');
else fail(`description is ${manifest.description.length} characters; the Chrome Web Store limit is 132`);

// ---- referenced files -----------------------------------------------------
const referenced = new Set();
Object.values(manifest.icons || {}).forEach((p) => referenced.add(p));
Object.values(manifest.action?.default_icon || {}).forEach((p) => referenced.add(p));
if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
(manifest.content_scripts || []).forEach((cs) => [...(cs.js || []), ...(cs.css || [])].forEach((p) => referenced.add(p)));
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);

if (manifest.action?.default_popup && existsSync(join(root, manifest.action.default_popup))) {
  const html = readFileSync(join(root, manifest.action.default_popup), 'utf8');
  for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) {
    if (!/^https?:/.test(m[1])) referenced.add(m[1]);
  }
}
for (const p of referenced) {
  if (existsSync(join(root, p))) ok(`found ${p}`); else fail(`missing file referenced by the extension: ${p}`);
}

// ---- icons ------------------------------------------------------------------
const PNG_SIG = '89504e470d0a1a0a';
for (const [size, p] of Object.entries(manifest.icons || {})) {
  const file = join(root, p);
  if (!existsSync(file)) continue;
  const buf = readFileSync(file);
  if (buf.subarray(0, 8).toString('hex') !== PNG_SIG) { fail(`${p} is not a PNG file`); continue; }
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w === +size && h === +size) ok(`${p} is ${w}×${h}`);
  else fail(`${p} is ${w}×${h}, but the manifest declares it as ${size}×${size}`);
}

// ---- JavaScript syntax ----------------------------------------------------
for (const p of [...referenced].filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', join(root, p)], { stdio: 'pipe' });
    ok(`${p} syntax OK`);
  } catch (e) {
    fail(`${p} has a syntax error:\n${e.stderr?.toString() || e.message}`);
  }
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s) found.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
