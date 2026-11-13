"""Objective comparison of candidate narration voices for hypnosis delivery.

Metrics (per voice/speed):
  wer        - Whisper (small.en) word error rate vs. the script (intelligibility / no garbling)
  wpm        - spoken words per minute excluding leading/trailing silence (hypnosis target ~95-125)
  f0_std_st  - pitch variability in semitones (lower = steadier, more soothing; too low = monotone)
  centroid   - spectral centroid Hz (lower = darker/softer timbre)
  peak_db    - sample peak (clipping check)
Writes tools/out/voice_compare.csv and WAVs to tools/out/voices/.
"""
import csv, subprocess, sys, re
from pathlib import Path
import numpy as np, soundfile as sf
import whisper, jiwer
from scipy.signal import resample_poly

OUT = Path(__file__).parent / "out" / "voices"; OUT.mkdir(parents=True, exist_ok=True)
TEXT = ("Let your eyes close whenever they are ready. Breathe in slowly... and let the breath go, "
        "a little longer on the way out. With every breath, your shoulders soften, and a quiet "
        "comfort begins to spread, all on its own. There is nothing you need to do right now.")

def norm(s):
    return re.sub(r"[^a-z' ]", " ", s.lower()).split()

def metrics(wav, sr, asr):
    x = wav.astype(np.float32)
    nz = np.where(np.abs(x) > 0.01)[0]
    active = (nz[-1] - nz[0]) / sr if len(nz) else 0
    x16 = resample_poly(x, 16000, sr).astype(np.float32)
    hyp = asr.transcribe(x16, language="en", fp16=False)["text"]
    wer = jiwer.wer(" ".join(norm(TEXT)), " ".join(norm(hyp)))
    # pitch via autocorrelation on 40ms frames
    fr = int(0.04 * sr); f0s = []
    for i in range(0, len(x) - fr, fr // 2):
        f = x[i:i+fr]
        if np.sqrt(np.mean(f**2)) < 0.02: continue
        ac = np.correlate(f, f, "full")[fr-1:]
        lo, hi = int(sr/400), int(sr/70)
        k = lo + np.argmax(ac[lo:hi])
        if ac[k] > 0.3 * ac[0]: f0s.append(sr / k)
    f0 = np.array(f0s)
    f0_std = float(np.std(12*np.log2(f0/np.median(f0)))) if len(f0) > 5 else float("nan")
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    freqs = np.fft.rfftfreq(len(x), 1/sr)
    centroid = float((spec*freqs).sum() / spec.sum())
    return dict(wer=round(wer,3), wpm=round(len(norm(TEXT))/active*60,1), f0_med=round(float(np.median(f0)),1) if len(f0) else 0,
                f0_std_st=round(f0_std,2), centroid=round(centroid), peak_db=round(20*np.log10(np.max(np.abs(x))+1e-9),1), hyp=hyp.strip())

def main():
    asr = whisper.load_model("small.en")
    rows = []
    from kokoro import KPipeline
    pipes = {"a": KPipeline(lang_code="a"), "b": KPipeline(lang_code="b")}
    voices = ["af_heart", "af_bella", "af_nicole", "af_sky", "af_sarah", "bf_emma", "bf_isabella", "am_michael", "bm_george", "bm_fable"]
    for v in voices:
        for speed in (0.8, 0.88):
            audio = np.concatenate([a.numpy() if hasattr(a, "numpy") else a for _, _, a in pipes[v[0]](TEXT, voice=v, speed=speed)])
            p = OUT / f"kokoro_{v}_{speed}.wav"; sf.write(p, audio, 24000)
            m = metrics(audio, 24000, asr); m.update(engine="kokoro", voice=v, speed=speed); rows.append(m); print(m, flush=True)
    for v in ("Daniel", "Karen", "Flo (English (US))"):
        p = OUT / f"say_{v.split()[0]}.aiff"
        subprocess.run(["say", "-v", v, "-r", "130", "-o", str(p), TEXT], check=True)
        audio, sr = sf.read(p)
        m = metrics(audio, sr, asr); m.update(engine="say", voice=v, speed=130); rows.append(m); print(m, flush=True)
    with open(OUT.parent / "voice_compare.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

if __name__ == "__main__":
    main()
