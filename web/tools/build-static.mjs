#!/usr/bin/env node
// Assembles a self-contained static site in web/dist/ for hosting later (any static host that
// serves HTTPS and supports HTTP range requests). Copies the app, the session files, the
// narration and the pre-rendered audio, and writes content/Sessions/index.json (the local
// server generates that listing on the fly).
//
//   node web/tools/build-static.mjs [--no-beds] [--max-file-mb 95]
//     --no-beds        leave out all noise-bed files
//     --max-file-mb N  leave out any audio file larger than N MB (GitHub rejects files over 100 MB)
// Sessions or beds left out play with the live engine instead.
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT, WEB, SESSIONS_DIR, NARRATION_DIR, AUDIO_DIR, sessionFiles } from './content-node.mjs';

const noBeds = process.argv.includes('--no-beds');
const maxMB = process.argv.includes('--max-file-mb') ? Number(process.argv[process.argv.indexOf('--max-file-mb') + 1]) : Infinity;
const OUT = path.join(WEB, 'dist');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of ['index.html', 'https.html', 'manifest.webmanifest', 'sw.js']) cpSync(path.join(WEB, f), path.join(OUT, f));
for (const d of ['css', 'js', 'icons', 'assets', 'lab']) cpSync(path.join(WEB, d), path.join(OUT, d), { recursive: true });
cpSync(SESSIONS_DIR, path.join(OUT, 'content/Sessions'), { recursive: true, filter: (p) => !p.endsWith('.DS_Store') });
writeFileSync(path.join(OUT, 'content/Sessions/index.json'), JSON.stringify({ files: sessionFiles() }));
cpSync(NARRATION_DIR, path.join(OUT, 'content/Narration'), { recursive: true, filter: (p) => !p.endsWith('.DS_Store') });
const tooBig = (p) => statSync(p).isFile() && statSync(p).size > maxMB * 1e6;
const isBed = (p) => /(^|[/\\])beds[/\\]|bed-\d+\.m4a$/.test(p);
cpSync(AUDIO_DIR, path.join(OUT, 'audio'), { recursive: true, filter: (p) => !(noBeds && isBed(p)) && !tooBig(p) && !p.endsWith('.DS_Store') });
{
  // Files left out must not be offered as pre-rendered: the app then plays them live.
  const idx = path.join(OUT, 'audio/renders.json');
  const r = JSON.parse(readFileSync(idx, 'utf8'));
  for (const e of Object.values(r.sessions)) {
    for (const [m, b] of Object.entries(e.beds)) if (!existsSync(path.join(OUT, 'audio', b.file))) delete e.beds[m];
    for (const [v, f] of Object.entries(e.variants)) if (!existsSync(path.join(OUT, 'audio', f.file))) delete e.variants[v];
  }
  for (const [id, e] of Object.entries(r.sessions)) if (!e.variants.binaural || !e.variants.isochronic || !e.variants.none) delete r.sessions[id];
  writeFileSync(idx, JSON.stringify(r, null, 1));
}
writeFileSync(path.join(OUT, '.nojekyll'), '');
let total = 0, largest = ['', 0];
const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else { total += s.size; if (s.size > largest[1]) largest = [path.relative(OUT, p), s.size]; } } };
walk(OUT);
console.log(`Static site in ${path.relative(ROOT, OUT)}/: ${(total / 1e6).toFixed(0)} MB; largest file ${largest[0]} (${(largest[1] / 1e6).toFixed(0)} MB).`);
console.log('Check your host’s per-file size limit against the largest file; --no-beds drops the multi-hour noise beds (Sleep then plays its bed with the live engine).');
