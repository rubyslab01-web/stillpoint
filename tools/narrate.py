#!/usr/bin/env python3
"""Regenerate all narration from Scripts/**/*.txt.

    ./narrate.sh            # rebuild only segments whose text/voice/speed changed
    ./narrate.sh --force    # rebuild everything
    ./narrate.sh --only qs- # only segment ids starting with a prefix

Script headers (apply to the blocks that follow; can change mid-file):
    # voice: af_heart                      one Kokoro voice
    # voice: af_heart*0.65+af_nicole*0.35  a weighted blend of voices
    # speed: 0.95      Kokoro speed. Keep it near 1: slowing Kokoro is what sounds robotic.
    # gap: 0.7         seconds of silence between sentences (slow, calm pacing without slowing the voice)
    # soft: on|off     gentler delivery: a slightly darker tone and 1.5 dB quieter

For every [segment-id] block it:
  1. synthesises speech with Kokoro, sentence by sentence, joined with the header's gap,
  2. trims edge silence and applies 15 ms fades,
  3. transcribes the audio back with Whisper and compares it to the script (WER),
     retrying at slightly different speeds if words were skipped or garbled,
  4. checks for clipping, normalises loudness to TARGET_LUFS with a peak ceiling,
  5. encodes AAC (.m4a) into App/Resources/Narration and records the duration in manifest.json.
Exits non-zero if any segment still fails verification (see tools/out/narration_report.csv).
"""
import argparse, csv, hashlib, json, re, subprocess, sys, warnings
from pathlib import Path
import numpy as np
import soundfile as sf

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "Scripts"
OUT = ROOT / "App" / "Resources" / "Narration"
CACHE = ROOT / "tools" / "cache"
REPORT = ROOT / "tools" / "out" / "narration_report.csv"
SR = 24000
TARGET_LUFS = -20.0
SOFT_LUFS = -21.5
SOFT_SHELF_DB = -3.0   # high shelf at 3.5 kHz for the soft voice
PEAK_CEILING_DB = -1.5
MAX_WER = 0.0          # after normalisation every word must come back
PIPELINE_VERSION = "5" # bump to invalidate the cache when processing changes

NUM = {"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six",
       "7": "seven", "8": "eight", "9": "nine", "10": "ten"}
EQUIV = {"ok": "okay", "alright": "all right", "centre": "center", "fingertips": "finger tips",
         "heartbeat": "heart beat", "goodnight": "good night", "loving-kindness": "loving kindness", "lightheaded": "light headed"}

CONTRACTIONS = {"you're": "you are", "we're": "we are", "they're": "they are", "i'm": "i am", "it's": "it is",
                "that's": "that is", "don't": "do not", "can't": "cannot", "you'll": "you will", "let's": "let us"}

def norm_words(s: str):
    s = s.lower().replace("’", "'").replace("-", " ")
    for k, v in CONTRACTIONS.items(): s = re.sub(rf"\b{re.escape(k)}\b", v, s)
    s = re.sub(r"[^a-z0-9' ]", " ", s)
    out = []
    for w in s.split():
        w = NUM.get(w, w)
        w = EQUIV.get(w, w)
        out.extend(w.split())
    return out

def parse_scripts():
    """Yield dict(id, text, voice, speed, source)."""
    seen = {}
    for path in sorted(SCRIPTS.rglob("*.txt")):
        voice, speed, gap, soft, cur, buf = "af_heart", 0.95, 0.0, False, None, []
        def flush():
            if cur is not None:
                text = " ".join(" ".join(buf).split())
                if not text: sys.exit(f"{path}: segment [{cur}] is empty")
                if cur in seen: sys.exit(f"Duplicate segment id [{cur}] in {path} and {seen[cur]}")
                seen[cur] = path
                segs.append(dict(id=cur, text=text, voice=voice, speed=speed, gap=gap, soft=soft, source=str(path.relative_to(ROOT))))
        segs = []
        for line in path.read_text().splitlines():
            line = line.strip()
            m = re.match(r"#\s*(voice|speed|gap|soft)\s*:\s*(\S+)", line)
            if m:
                flush(); cur, buf = None, []
                k, v = m.group(1), m.group(2)
                if k == "voice": voice = v
                elif k == "speed": speed = float(v)
                elif k == "gap": gap = float(v)
                else: soft = v.lower() in ("on", "yes", "true", "1")
                continue
            if line.startswith("#"): continue
            m = re.match(r"\[([A-Za-z0-9_-]+)\]$", line)
            if m:
                flush(); cur, buf = m.group(1), []
            elif line and cur is not None:
                buf.append(line)
        flush()
        yield from segs

_pipes = {}
def _voice(pipe, spec):
    """'af_heart' or a weighted blend like 'af_heart*0.65+af_nicole*0.35'."""
    if "+" not in spec and "*" not in spec: return spec
    total, acc = 0.0, None
    for part in spec.split("+"):
        name, _, w = part.partition("*")
        w = float(w or 1)
        t = pipe.load_single_voice(name.strip()) * w
        acc = t if acc is None else acc + t
        total += w
    return acc / total

def _say(pipe, text, voice, speed):
    parts = [a.numpy() if hasattr(a, "numpy") else np.asarray(a) for _, _, a in pipe(text, voice=voice, speed=speed)]
    return np.concatenate(parts).astype(np.float32)

def synth(text, voice, speed, gap=0.0):
    from kokoro import KPipeline
    lang = voice[0]
    if lang not in _pipes: _pipes[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    pipe = _pipes[lang]
    v = _voice(pipe, voice)
    if gap <= 0: return _say(pipe, text, v, speed)
    # Sentence by sentence with real silence between: calm pacing from pauses, not from slowing
    # the voice (slowed Kokoro is what sounded robotic).
    sentences = [x for x in re.split(r"(?<=[.!?])\s+", text) if x.strip()]
    out = []
    for i, sent in enumerate(sentences):
        out.append(trim(_say(pipe, sent, v, speed), pad=0.03, tail=0.08))
        if i < len(sentences) - 1: out.append(np.zeros(int(gap * SR), np.float32))
    return np.concatenate(out)

def soften(x):
    """High shelf (RBJ) at 3.5 kHz: a slightly darker, gentler tone."""
    from scipy.signal import lfilter
    A = 10 ** (SOFT_SHELF_DB / 40); w0 = 2 * np.pi * 3500 / SR; alpha = np.sin(w0) / 2 * np.sqrt(2)
    c = np.cos(w0); sA = 2 * np.sqrt(A) * alpha
    b = [A * ((A + 1) + (A - 1) * c + sA), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sA)]
    a = [(A + 1) - (A - 1) * c + sA, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sA]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x).astype(np.float32)

def trim(x, thresh=0.004, pad=0.06, tail=0.12):
    idx = np.where(np.abs(x) > thresh)[0]
    if len(idx) == 0: return x
    a, b = max(0, idx[0] - int(pad * SR)), min(len(x), idx[-1] + int(tail * SR))
    y = x[a:b].copy()
    n = min(int(0.015 * SR), len(y) // 2)
    y[:n] *= np.linspace(0, 1, n); y[-n:] *= np.linspace(1, 0, n)
    return y

_asr = None
def transcribe(x):
    global _asr
    import whisper
    from scipy.signal import resample_poly
    if _asr is None: _asr = whisper.load_model("small.en")
    x16 = resample_poly(x, 2, 3).astype(np.float32)
    x16 = np.concatenate([np.zeros(4000, np.float32), x16, np.zeros(4000, np.float32)])
    return _asr.transcribe(x16, language="en", fp16=False, temperature=0.0, condition_on_previous_text=False)["text"].strip()

def wer(ref, hyp):
    import jiwer
    r, h = norm_words(ref), norm_words(hyp)
    if not r: return 0.0
    return jiwer.wer(" ".join(r), " ".join(h)) if h else 1.0

def limit(y, ceiling):
    """Transparent look-ahead peak limiter: gain dips smoothly (5 ms window) only around
    samples above the ceiling, so loud consonants are tamed without changing overall level."""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    mag = np.abs(y)
    g = np.where(mag > ceiling, ceiling / np.maximum(mag, 1e-9), 1.0)
    w = int(0.005 * SR) | 1
    g = uniform_filter1d(minimum_filter1d(g, size=w), size=w)
    return y * g

def normalise(x, target=TARGET_LUFS):
    """Gain to TARGET_LUFS, limiting peaks rather than turning the whole segment down, so
    every segment lands within ~0.5 LU of the target regardless of its crest factor."""
    import pyloudnorm as pyln
    meter = pyln.Meter(SR)
    def loud(v):
        pad = v if len(v) >= SR else np.concatenate([v, np.zeros(SR - len(v), np.float32)])
        l = meter.integrated_loudness(pad.astype(np.float64))
        return l if np.isfinite(l) else 20 * np.log10(np.sqrt(np.mean(v ** 2)) + 1e-9)
    ceiling = 10 ** (PEAK_CEILING_DB / 20)
    y = x.astype(np.float64)
    for _ in range(4):
        y = limit(y * 10 ** ((target - loud(y)) / 20), ceiling)
    y = np.clip(y, -ceiling, ceiling)
    return y.astype(np.float32), float(loud(y)), float(20 * np.log10(np.max(np.abs(y)) + 1e-9))

def encode(wav_path, m4a_path):
    subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "64000", "-q", "127", str(wav_path), str(m4a_path)],
                   check=True, capture_output=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--check", action="store_true", help="only report what would be rebuilt")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True); CACHE.mkdir(parents=True, exist_ok=True); REPORT.parent.mkdir(parents=True, exist_ok=True)
    segs = list(parse_scripts())
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())["segments"] if manifest_path.exists() else {}
    rows, failures, built = [], [], 0
    for s in segs:
        key = hashlib.sha256(f"{PIPELINE_VERSION}|{s['voice']}|{s['speed']}|{s['gap']}|{s['soft']}|{s['text']}".encode()).hexdigest()[:16]
        meta_path = CACHE / f"{s['id']}.json"
        m4a = OUT / f"{s['id']}.m4a"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        fresh = meta.get("key") == key and m4a.exists() and s["id"] in manifest and meta.get("ok")
        if fresh and not args.force or (args.only and not s["id"].startswith(args.only)):
            if meta: rows.append(meta)
            continue
        if args.check: print("stale:", s["id"]); continue
        best = None
        # Try the requested speed first, then small nudges: a different speed changes the
        # model's alignment, which usually fixes a skipped or slurred word.
        for attempt, dv in enumerate([0, -0.03, 0.03, -0.05, 0.05]):
            raw = synth(s["text"], s["voice"], s["speed"] + dv, s["gap"])
            if s["soft"]: raw = soften(raw)
            clipped = bool(np.max(np.abs(raw)) >= 0.999)
            x = trim(raw)
            hyp = transcribe(x)
            w = wer(s["text"], hyp)
            cand = dict(x=x, wer=w, hyp=hyp, clipped=clipped, speed=s["speed"] + dv, attempt=attempt)
            if best is None or (w, clipped) < (best["wer"], best["clipped"]): best = cand
            if w <= MAX_WER and not clipped: break
        y, lufs, peak = normalise(best["x"], SOFT_LUFS if s["soft"] else TARGET_LUFS)
        wav = CACHE / f"{s['id']}.wav"
        sf.write(wav, y, SR, subtype="PCM_16")
        encode(wav, m4a); wav.unlink()
        dur = len(y) / SR
        nwords = len(norm_words(s["text"]))
        ok = best["wer"] <= MAX_WER and not best["clipped"]
        meta = dict(id=s["id"], key=key, ok=ok, wer=round(best["wer"], 3), clipped=best["clipped"], lufs=round(lufs, 1),
                    peak_db=round(peak, 1), duration=round(dur, 3), wpm=round(nwords / dur * 60), voice=s["voice"],
                    speed=round(best["speed"], 2), attempts=best["attempt"] + 1, text=s["text"], heard=best["hyp"])
        meta_path.write_text(json.dumps(meta, indent=1))
        manifest[s["id"]] = dict(duration=round(dur, 3), file=m4a.name, voice=s["voice"], text=s["text"])
        rows.append(meta); built += 1
        flag = "ok " if ok else "FAIL"
        print(f"{flag} {s['id']:<22} {dur:5.1f}s wer={best['wer']:.2f} lufs={lufs:.1f} peak={peak:.1f} tries={best['attempt']+1}", flush=True)
        if not ok: failures.append(meta)
    if args.check: return
    # Drop audio for segments that no longer exist in any script.
    ids = {s["id"] for s in segs}
    for stale in [k for k in manifest if k not in ids]:
        manifest.pop(stale); (OUT / f"{stale}.m4a").unlink(missing_ok=True); (CACHE / f"{stale}.json").unlink(missing_ok=True)
    manifest_path.write_text(json.dumps({"segments": dict(sorted(manifest.items()))}, indent=1))
    rows = [r for r in rows if r.get("id") in ids]
    if rows:
        fields = ["id", "ok", "wer", "clipped", "lufs", "peak_db", "duration", "wpm", "voice", "speed", "attempts", "text", "heard"]
        with open(REPORT, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore"); w.writeheader(); w.writerows(rows)
    still_bad = [r for r in rows if not r.get("ok")]
    total = sum(m["duration"] for m in manifest.values())
    print(f"\n{len(segs)} segments, {built} rebuilt, {total/60:.1f} min of narration, {len(still_bad)} failing verification")
    for r in still_bad:
        print(f"  FAIL {r['id']}: wer={r['wer']} clipped={r['clipped']}\n    script: {r['text']}\n    heard : {r['heard']}")
    sys.exit(1 if still_bad else 0)

if __name__ == "__main__":
    main()
