import argparse, hashlib, json, re, shutil, subprocess, sys, time, wave
from pathlib import Path
import numpy as np
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

OUT = Path(r"C:\Users\Darth\Documents\Claude\DryWatch\scripts\mimic_run")
SHARE = "https://vt.tiktok.com/ZSpMMQKs8/"
UA = ("Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0.7339.100 Mobile Safari/537.36")
PAGE_HDRS = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
             "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}


def hr(t):
    print("\n" + "=" * 64 + "\n" + t + "\n" + "=" * 64)


# ------------------------------------------------------------ fetch
def set_cookies(resp):
    try:
        return resp.raw.headers.getlist("Set-Cookie")
    except Exception:
        v = resp.headers.get("Set-Cookie")
        return [v] if v else []


def fetch_page():
    s = requests.Session()
    s.headers.update(PAGE_HDRS)
    token = None
    r0 = s.get("https://www.tiktok.com/", timeout=30)
    print(f"warmup: HTTP {r0.status_code}, {len(r0.content)} bytes")
    print("  cookie names received:", sorted({c.name for c in s.cookies}))
    r = s.get(SHARE, timeout=30, allow_redirects=True)
    print(f"post page: HTTP {r.status_code}, {len(r.content)} bytes")
    print(f"  final URL: {r.url}")
    for resp in [r0] + list(r.history) + [r]:
        for sc in set_cookies(resp):
            m = re.search(r"tt_chain_token=([^;]+)", sc)
            if m:
                token = m.group(1)
    if not token:
        for c in s.cookies:
            if c.name == "tt_chain_token":
                token = c.value
    print("  cookie names after post page:", sorted({c.name for c in s.cookies}))
    if token:
        print(f"  tt_chain_token: len={len(token)} first10={token[:10]}")
    else:
        print("  tt_chain_token: MISSING")
    return r.text, token


# ------------------------------------------------------------ parse
def get_json(html, sid):
    m = re.search(r'<script[^>]*\bid="%s"[^>]*>(.*?)</script>' % re.escape(sid), html, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception as e:
        print(f"  {sid}: JSON error {e}")
        return None


def deep_find(o, depth=0):
    if depth > 14:
        return None
    if isinstance(o, dict):
        if ("playAddr" in o or "downloadAddr" in o) and "duration" in o:
            return o
        for v in o.values():
            f = deep_find(v, depth + 1)
            if f:
                return f
    elif isinstance(o, list):
        for v in o[:300]:
            f = deep_find(v, depth + 1)
            if f:
                return f
    return None


def parse_item(html):
    d = get_json(html, "api-data")
    if isinstance(d, dict):
        vd = d.get("videoDetail", d)
        sc = vd.get("statusCode") if isinstance(vd, dict) else None
        print("  api-data statusCode:", sc)
        it = ((vd.get("itemInfo") or {}).get("itemStruct")) if isinstance(vd, dict) else None
        if sc == 0 and it:
            return "api-data", sc, it
    d = get_json(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__")
    if isinstance(d, dict):
        print(f"  rehydration JSON: {len(json.dumps(d))} chars")
        scope = d.get("__DEFAULT_SCOPE__", {})
        for k in ("webapp.video-detail", "webapp.reflow.video.detail"):
            n = scope.get(k)
            if not isinstance(n, dict):
                continue
            sc = n.get("statusCode")
            print(f"  {k} statusCode: {sc}")
            it = (n.get("itemInfo") or {}).get("itemStruct")
            if sc == 0 and it:
                return k, sc, it
        v = deep_find(d)
        if v:
            return "deep-search", None, {"video": v}
    return None, None, None


def addr(v, key):
    a = v.get(key)
    if isinstance(a, dict):
        ul = a.get("UrlList") or a.get("urlList") or []
        a = ul[0] if ul else None
    return a or None


# ------------------------------------------------------------ download
def download(url, dest, token):
    h = {"Referer": "https://www.tiktok.com/", "Accept": "*/*",
         "Accept-Language": "en-US,en;q=0.9"}
    if token:
        h["Cookie"] = f"tt_chain_token={token}"
    print(f"  -> {dest.name}  chainToken={'len=' + str(len(token)) if token else 'MISSING'}")
    # plain requests.get (no session) so ONLY the explicit Cookie header is sent, like the app
    tries = [("requests", lambda: requests.get(url, headers={**h, "User-Agent": UA}, timeout=300))]
    try:
        from curl_cffi import requests as cr
        tries.append(("curl_cffi chrome", lambda: cr.get(url, headers={**h, "User-Agent": UA},
                                                          impersonate="chrome", timeout=300)))
    except ImportError:
        print("  (curl_cffi not installed, only plain requests will be tried)")
    for name, fn in tries:
        try:
            r = fn()
        except Exception as e:
            print(f"  [{name}] failed: {e}")
            continue
        print(f"  [{name}] HTTP {r.status_code} content-type={r.headers.get('content-type')} "
              f"content-length={r.headers.get('content-length')}")
        if r.status_code == 200 and len(r.content) > 0:
            dest.write_bytes(r.content)
            print(f"  [{name}] saved {len(r.content)} bytes")
            return True
        print(f"  [{name}] not usable. NOTE: this PC's TLS fingerprint differs from Cronet's, so a "
              "403 here may be a PC-only artifact, NOT proof the phone is broken.")
    return False


# ------------------------------------------------------------ ffprobe / audio
def probe(p):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(p)],
                         capture_output=True, text=True)
    j = json.loads(out.stdout)
    keys = ("index", "codec_type", "codec_name", "profile", "sample_rate", "channels",
            "channel_layout", "bit_rate", "width", "height", "duration")
    for s in j.get("streams", []):
        print("  stream:", {k: s.get(k) for k in keys})
    f = j.get("format", {})
    print("  format:", {k: f.get(k) for k in ("format_name", "duration", "size", "bit_rate")})
    return j


def copy_pcm16_mono(raw, rate, ch, target=16000):
    """Port of copyPcm16Mono as described: sourceIndex = targetIndex*rate/16000, average all
    channels at that frame, no filtering, no real resampler."""
    pcm = np.frombuffer(raw, dtype="<i2")
    frames = len(pcm) // ch
    pcm = pcm[:frames * ch].reshape(frames, ch).astype(np.int64)
    n_out = max(1, frames * target // rate)
    idx = np.minimum((np.arange(n_out, dtype=np.int64) * rate) // target, frames - 1)
    mono = np.fix(pcm[idx].sum(axis=1) / ch).astype(np.int64)
    return np.clip(mono, -32768, 32767).astype("<i2")


def write_wav(path, samples, rate=16000):
    with wave.open(str(path), "wb") as w:  # standard 44-byte header
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())


def band_stats(x, sr=16000):
    X = np.abs(np.fft.rfft(x)) ** 2
    f = np.fft.rfftfreq(len(x), 1.0 / sr)
    tot = X.sum() + 1e-9
    n2 = float(len(x)) ** 2
    return {"low<300": X[f < 300].sum() / tot * 100,
            "speech300-3400": X[(f >= 300) & (f < 3400)].sum() / tot * 100,
            "high3400-8000": X[f >= 3400].sum() / tot * 100,
            "_hi_abs": X[f >= 3400].sum() / n2}


def inspect(p):
    with wave.open(str(p)) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64)
    rms = float(np.sqrt(np.mean(x ** 2)))
    peak = float(np.abs(x).max())
    sil = float(np.mean(np.abs(x) < 200) * 100)
    print(f"\n  {p.name}: {len(x) / sr:.2f}s, {len(x)} samples, rate={sr}")
    print(f"    RMS={rms:.1f}  peak={peak:.0f}  silent(<200)={sil:.1f}%")
    b = band_stats(x, sr)
    print("    energy by band: " + "  ".join(f"{k}={v:.1f}%" for k, v in b.items() if not k.startswith("_")))
    print("    1s RMS profile (first 20 windows):")
    for i in range(min(20, len(x) // sr)):
        w_rms = float(np.sqrt(np.mean(x[i * sr:(i + 1) * sr] ** 2)))
        print(f"      {i:2d}s rms={w_rms:7.1f} {'#' * int(w_rms / 300)}")
    return {"x": x, "rms": rms, "peak": peak, "sil": sil, "bands": b}


def run_whisper(wavs, model):
    exe = shutil.which("whisper-cli") or shutil.which("main") or shutil.which("whisper")
    if not exe:
        print("  skipped: whisper-cli / main not found on PATH")
        return
    if not model:
        for c in (Path.cwd() / "ggml-small.bin", OUT / "ggml-small.bin"):
            if c.exists():
                model = str(c)
                break
    if not model:
        print("  skipped: no model path (set $Model at the top of the command)")
        return
    for w in wavs:
        for lang in ("auto", "en"):
            print(f"\n  >>> {w.name}   -l {lang}")
            try:
                r = subprocess.run([exe, "-m", model, "-f", str(w), "-l", lang, "-nt"],
                                   capture_output=True, text=True, timeout=1500)
            except Exception as e:
                print("  failed:", e)
                continue
            print("  output:", (r.stdout.strip() or "(empty)")[:2500])
            for line in r.stderr.splitlines():
                if "auto-detected" in line.lower() or "language" in line.lower():
                    print("  stderr:", line.strip())


# ------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mp4")
    ap.add_argument("--model")
    ap.add_argument("--rate", type=int)
    ap.add_argument("--channels", type=int)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    play = OUT / "playaddr.mp4"
    dlf = OUT / "downloadaddr.mp4"
    have_dl = False

    if a.mp4:
        play = Path(a.mp4)
        hr("Using supplied MP4 (download skipped)")
    else:
        hr("Steps 1-3: warmup, post page, parse")
        item = token = None
        for attempt in range(1, 4):
            print(f"\nattempt {attempt}/3")
            html, token = fetch_page()
            branch, sc, item = parse_item(html)
            if item:
                print(f"  PARSE OK: branch={branch} statusCode={sc} (succeeded on attempt {attempt})")
                break
            print("  blocked / no item (statusCode 10204 is intermittent)")
            if attempt < 3:
                print("  waiting 5s then retrying")
                time.sleep(5)
        if not item:
            sys.exit("\nNo item after 3 attempts. Re-run later, or set $Mp4 to a file from the phone.")
        v = item.get("video", {})
        print(f"\n  videoId  = {item.get('id')}")
        print(f"  duration = {v.get('duration')}")
        print(f"  caption  = {item.get('desc')}")
        print(f"  author   = {(item.get('author') or {}).get('uniqueId')}")
        play_url, dl_url = addr(v, "playAddr"), addr(v, "downloadAddr")
        print(f"  playAddr     = {play_url}")
        print(f"  downloadAddr = {dl_url}")
        print("  video keys:", sorted(v.keys()))
        print("  item keys :", sorted(item.keys()))
        if isinstance(item.get("music"), dict):
            print("  music keys:", sorted(item["music"].keys()))
        (OUT / "video_object.json").write_text(json.dumps(v, indent=2, default=str), encoding="utf-8")
        (OUT / "item_meta.json").write_text(
            json.dumps({k: x for k, x in item.items() if k != "video"}, indent=2, default=str)[:60000],
            encoding="utf-8")

        hr("Step 4: download")
        ok = bool(play_url) and download(play_url, play, token)
        if dl_url:
            print("downloadAddr:")
            have_dl = download(dl_url, dlf, token)
        if not ok and have_dl:
            print("playAddr failed, using downloadaddr.mp4 as the main file")
            play = dlf
        elif not ok:
            sys.exit("\nDownload failed. If these were 403s, that may be PC-only (TLS fingerprint). "
                     "Get the MP4 off the phone and set $Mp4.")

    hr("Step 5: ffprobe")
    print(play.name + ":")
    pj = probe(play)
    if have_dl and play != dlf:
        print("downloadaddr.mp4:")
        probe(dlf)
        same = hashlib.sha256(play.read_bytes()).hexdigest() == hashlib.sha256(dlf.read_bytes()).hexdigest()
        print("  playaddr vs downloadaddr byte-identical:", same)
    ast = [s for s in pj.get("streams", []) if s.get("codec_type") == "audio"]
    if not ast:
        sys.exit("NO AUDIO STREAM in the MP4.")
    if len(ast) > 1:
        print(f"  NOTE: {len(ast)} audio streams; the app uses the first")
    probe_rate, probe_ch = int(ast[0]["sample_rate"]), int(ast[0]["channels"])

    hr("Step 6: extract audio")
    ref = OUT / "reference.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(play), "-vn", "-ac", "1", "-ar", "16000",
                    "-acodec", "pcm_s16le", str(ref)], check=True)
    native = OUT / "_native.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(play), "-map", "0:a:0", "-vn",
                    "-acodec", "pcm_s16le", str(native)], check=True)
    with wave.open(str(native)) as w:
        nrate, nch = w.getframerate(), w.getnchannels()
        raw = w.readframes(w.getnframes())
    native.unlink()
    print(f"  ffprobe says: rate={probe_rate} ch={probe_ch}")
    print(f"  decoder output: rate={nrate} ch={nch}  ({len(raw)} bytes PCM)")
    if (nrate, nch) != (probe_rate, probe_ch):
        print("  !! container and decoder output DIFFER (implicit SBR / HE-AAC?). This is exactly the "
              "kind of thing that makes Android decoders report the wrong format.")
    rate = a.rate or nrate
    ch = a.channels or nch
    print(f"  mimic assumes: rate={rate} ch={ch}" + ("  (OVERRIDDEN)" if a.rate or a.channels else ""))
    mim = OUT / "app_mimic.wav"
    write_wav(mim, copy_pcm16_mono(raw, rate, ch))
    print(f"  wrote {ref.name} and {mim.name}")

    hr("Step 7: inspect WAVs")
    sr_ = inspect(ref)
    sm_ = inspect(mim)
    print(f"\n  length: reference={len(sr_['x'])} mimic={len(sm_['x'])} (diff {len(sr_['x']) - len(sm_['x'])})")
    hi_db = 10 * np.log10((sm_["bands"]["_hi_abs"] + 1e-12) / (sr_["bands"]["_hi_abs"] + 1e-12))
    print(f"  mimic vs reference: RMS ratio={sm_['rms'] / (sr_['rms'] + 1e-9):.2f}, "
          f"3.4-8kHz energy difference={hi_db:+.1f} dB (positive = aliasing-like extra high band)")
    print("  (sample-by-sample diff is not meaningful across different resamplers; compare bands/RMS)")

    hr("Step 8: whisper.cpp")
    run_whisper([ref, mim], a.model)

    hr("Verdict hints (heuristic, Whisper -l en and listening decide)")
    r = sr_
    if r["rms"] < 50 or r["sil"] > 90:
        print("  (a) reference audio is essentially SILENT -> problem is the source file")
    else:
        sp = r["bands"]["speech300-3400"]
        print(f"  reference has signal: RMS={r['rms']:.0f}, {sp:.0f}% of energy in 300-3400 Hz")
        print("  silent/noise/music-only/speech cannot be told apart by numbers alone: read the Whisper "
              "-l en output above and LISTEN to reference.wav")
    if abs(sm_["rms"] / (sr_["rms"] + 1e-9) - 1) > 0.25 or abs(hi_db) > 3:
        print("  mimic differs noticeably from reference -> the resampler/channel handling matters")
    else:
        print("  mimic is statistically close to reference -> resampler alone is probably not the bug")
    if (nrate, nch) != (probe_rate, probe_ch):
        print("  decoder format differs from container -> check the decoder OUTPUT format on the phone")

    hr("Step 9: artifacts")
    for p in sorted(OUT.iterdir()):
        print(f"  {p.name:<28}{p.stat().st_size:>12} bytes")
    print("\nCaveats: ffmpeg's AAC decode is not MediaCodec, so a clean result here does not clear "
          "the phone's decoder. A CDN 403 on this PC may be a PC-only TLS artifact.")


if __name__ == "__main__":
    main()