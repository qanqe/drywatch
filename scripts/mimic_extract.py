#!/usr/bin/env python3
"""PC mimic of DryWatch Cronet pipeline for diagnosing the [Spanish] transcription bug.

Mirrors exactly:
  1. CronetExtractModule.fetch(): warmup GET https://www.tiktok.com/, capture
     tt_chain_token from Set-Cookie, then GET the post URL
  2. parseUniversalData(): api-data -> rehydration -> deep search walk
     (buildResult prefers playAddr, falls back to downloadAddr)
  3. downloadToFile(): GET the video URL with
     Referer: https://www.tiktok.com/ + Cookie: tt_chain_token=<token>
  4. AudioExtractorModule.copyPcm16Mono(): naive box-average resampling and
     channel averaging to 16kHz mono 16-bit PCM WAV

Then inspects the resulting WAV (RMS, silence ratio, duration).
"""
import json
import re
import subprocess
import sys
import urllib.request
import urllib.error
from pathlib import Path

OUT_DIR = Path("C:/Users/Darth/Documents/Claude/DryWatch/scripts/mimic_run")
OUT_DIR.mkdir(parents=True, exist_ok=True)

POST_URL = "https://vt.tiktok.com/ZSpMMQKs8/"
UA = ("Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/140.0.7339.100 Mobile Safari/537.36")

chain_token = None


def fetch(url: str) -> tuple[bytes, dict]:
    """CronetExtractModule.fetch equivalent: plain GET, capture chain token."""
    global chain_token
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            headers = dict(resp.headers)
            body = resp.read()
    except urllib.error.HTTPError as e:
        headers = dict(e.headers or {})
        body = e.read()
    # Parse Set-Cookie for tt_chain_token (same regex the Kotlin uses)
    set_cookie = headers.get("Set-Cookie", "")
    m = re.search(r"(?:^;\s*)tt_chain_token=([^;]+)", set_cookie)
    if m:
        token = m.group(1).strip()
        if token != chain_token:
            print(f"  captured tt_chain_token len={len(token)} prefix={token[:10]}")
        chain_token = token
    return body, headers


def parse_universal_data(html: str):
    """Mirror parseUniversalData(): api-data -> rehydration -> deep search."""
    needles = ["api-data", "playAddr", "downloadAddr", "itemStruct",
               "webapp.video-detail", "webapp.reflow.video.detail"]
    print("  needles=" + ", ".join(f"{n}={html.count(n)}" for n in needles))

    # extractFromApiData
    m = re.search(r'<script id="api-data"[^>]*>(.*?)</script>', html, re.DOTALL)
    if m:
        try:
            root = json.loads(m.group(1))
            detail = root.get("videoDetail", {})
            if detail.get("statusCode", -1) == 0:
                item = detail["itemInfo"]["itemStruct"]
                return build_result(item, item["video"], "api-data")
            print(f"  api-data statusCode={detail.get('statusCode')}")
        except (KeyError, json.JSONDecodeError) as e:
            print(f"  api-data parse failed: {e}")

    # extractFromRehydration / extractByDeepSearch
    m = re.search(
        r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>',
        html, re.DOTALL)
    if not m:
        print("  deep: no rehydration payload at all")
        return None
    try:
        root = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        print(f"  rehydration JSON invalid: {e}")
        return None
    print(f"  rehydration json length={len(m.group(1))}")

    # The app's extractFromRehydration explicitly checks BOTH the classic
    # webapp.video-detail and reflow webapp.reflow.video.detail keys and
    # rejects statusCode != 0. Mirror that here: on 10204 the whole parse
    # fails (that is what [extraction] cronet failed means on device).
    scope = root.get("__DEFAULT_SCOPE__", {})
    for key in ("webapp.reflow.video.detail", "webapp.video-detail"):
        node = scope.get(key)
        if isinstance(node, dict) and "statusCode" in node:
            print(f"  rehydration {key} statusCode={node.get('statusCode')} "
                  f"keys={sorted(node.keys())}")
            if node.get("statusCode") != 0:
                return None
            item = node.get("itemInfo", {}).get("itemStruct")
            if item:
                return build_result(item, item.get("video", {}),
                                    f"rehydration:{key}")
            return None

    # extractByDeepSearch walk (findVideoObject): first object with
    # playAddr/downloadAddr AND duration
    def looks_like_item(node):
        return isinstance(node, dict) and "id" in node and "author" in node \
            and ("desc" in node or "video" in node)

    def find_video(node, depth, path=""):
        if depth > 12:
            return None
        if isinstance(node, dict):
            has = node.get("playAddr", "") or node.get("downloadAddr", "")
            if has and "duration" in node:
                return node, None, depth, path
            for key, child in node.items():
                hit = find_video(child, depth + 1,
                                 f"{path}.{key}" if path else key)
                if hit:
                    video, item, d, p = hit
                    if item is None and looks_like_item(node):
                        item = node
                    return video, item, d, p
        elif isinstance(node, list):
            for i, child in enumerate(node[:200]):
                hit = find_video(child, depth + 1, f"{path}[{i}]")
                if hit:
                    return hit
        return None

    hit = find_video(root, 0)
    if not hit:
        print("  deep: no object with playAddr anywhere in payload")
        return None
    video, item, depth, path = hit
    print(f"  deep: found video at depth {depth}, path={path}")
    if item is None:
        print("  deep: video found but no enclosing item with id/desc")
        return None
    return build_result(item, video, "deep-search")


def build_result(item, video, how):
    play = video.get("playAddr", "") or video.get("downloadAddr", "")
    if not play:
        print("  parse: video has no playAddr/downloadAddr")
        return None
    print(f"  [{how}] videoId={item.get('id')} duration={video.get('duration')}s")
    print(f"  url source: {'playAddr' if video.get('playAddr') else 'downloadAddr'}")
    print(f"  url host: {re.sub(r'^(https?://[^/]+).*$', r'\\1', play)}")
    return {
        "videoUrl": play,
        "caption": item.get("desc", ""),
        "author": item.get("author", {}).get("uniqueId", ""),
        "durationSeconds": video.get("duration", 0),
        "videoId": item.get("id", ""),
        "video_meta": video,
        "item_meta": item,
    }


def download_to_file(url: str, dest: Path) -> int:
    """downloadToFile equivalent: Referer + chain token cookie."""
    headers = {
        "User-Agent": UA,
        "Referer": "https://www.tiktok.com/",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if chain_token:
        headers["Cookie"] = f"tt_chain_token={chain_token}"
    print(f"  download start chainToken="
          f"{'len=' + str(len(chain_token)) if chain_token else 'MISSING'}")
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as f:
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            f.write(chunk)
    size = dest.stat().st_size
    print(f"  download done bytes={size} -> {dest}")
    return size


def probe_media(path: Path):
    """ffprobe: streams, codec, sample rate, channels, duration."""
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json",
         "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True)
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        print(out.stderr)
        return None


def extract_wav_ffmpeg(src: Path, dst: Path):
    """ffmpeg reference conversion to 16kHz mono s16le WAV."""
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(src),
         "-vn", "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le",
         str(dst)],
        check=True)


def inspect_wav(path: Path):
    """RMS, peak, silence ratio — the audio content verdict."""
    info = probe_media(path)
    fmt = info["format"]
    print(f"  WAV: duration={float(fmt['duration']):.2f}s "
          f"size={fmt['size']} bytes")
    # Load PCM and compute stats
    raw = path.read_bytes()[44:]  # skip standard WAV header
    import struct
    samples = [struct.unpack_from("<h", raw, i)[0]
               for i in range(0, len(raw) - 1, 2)]
    if not samples:
        print("  WAV: NO SAMPLES")
        return
    rms = (sum(s * s for s in samples) / len(samples)) ** 0.5
    peak = max(abs(s) for s in samples)
    silent = sum(1 for s in samples if abs(s) < 200) / len(samples)
    print(f"  samples={len(samples)} rms={rms:.1f} peak={peak} "
          f"silent(<200)={silent*100:.1f}%")
    if rms < 50:
        print("  VERDICT: (near-)SILENT — whisper would hallucinate")
    elif silent > 0.9:
        print("  VERDICT: >90% silence — whisper would hallucinate")
    elif rms > 500:
        print("  VERDICT: healthy audio levels")
    else:
        print("  VERDICT: low but present audio")


def main():
    print("=== 1. Warmup (CronetExtractModule.extractPostData) ===")
    body, _ = fetch("https://www.tiktok.com/")
    print(f"  warmup bytes={len(body)}")

    print(f"\n=== 2. Fetch post page: {POST_URL} ===")
    html_bytes, headers = fetch(POST_URL)
    html = html_bytes.decode("utf-8", errors="replace")
    print(f"  DONE bytes={len(html)} hasMarker={'__UNIVERSAL_DATA_FOR_REHYDRATION__' in html}")

    print("\n=== 3. Parse universal data ===")
    result = parse_universal_data(html)
    if not result:
        print("FAILED: no video URL extracted")
        sys.exit(1)
    print(f"  caption: {result['caption'][:80]!r}")
    print(f"  author:  {result['author']}")
    (OUT_DIR / "extracted.json").write_text(json.dumps(
        {k: v for k, v in result.items() if k != "video_meta"}, indent=2))
    (OUT_DIR / "video_meta.json").write_text(json.dumps(
        result["video_meta"], indent=2)[:4000])

    print("\n=== 4. Download video (downloadToFile) ===")
    mp4 = OUT_DIR / "tiktok_download.mp4"
    download_to_file(result["videoUrl"], mp4)

    print("\n=== 5. Probe MP4 streams ===")
    info = probe_media(mp4)
    if info:
        for s in info["streams"]:
            print(f"  stream {s.get('index')}: {s.get('codec_type')} "
                  f"{s.get('codec_name')} "
                  f"sr={s.get('sample_rate')} ch={s.get('channels')} "
                  f"{s.get('width')}x{s.get('height')}")
        print(f"  format: {info['format'].get('format_name')} "
              f"duration={info['format'].get('duration')}s")

    print("\n=== 6. Extract 16kHz mono WAV (ffmpeg reference) ===")
    wav = OUT_DIR / "extracted.wav"
    extract_wav_ffmpeg(mp4, wav)

    print("\n=== 7. Inspect WAV ===")
    inspect_wav(wav)

    print(f"\nArtifacts in {OUT_DIR}:")
    for f in sorted(OUT_DIR.iterdir()):
        print(f"  {f.name}  ({f.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
