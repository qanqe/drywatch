# The problem: getting TikTok videos into our Android app without asking the user to manually download them first

## What the app is

DryWatch is an Android app (React Native 0.88 + native Kotlin modules). A user
either:
- pastes/shares a TikTok link into the app, or
- picks a video file already saved on their phone

The app then runs on-device processing (Whisper transcription, OCR of on-screen
text, caption/subtitle extraction) and produces a context document. The
on-device processing works and is tested. The problem is entirely in step one:
turning a TikTok **link** into an actual **video file** on the phone, without
the user having to manually download the video themselves first (that would
defeat the point of the product — "paste a link" has to actually work).

## The core obstacle: TikTok blocks non-browser HTTP clients

TikTok's web pages are protected by a bot-detection layer (a WAF / "Slardar"
challenge system). When a normal HTTP client (not a real browser) requests a
TikTok video page, one of two things happens:
1. TikTok serves a short "challenge" HTML page instead of the real content, or
2. TikTok rejects the request outright based on its TLS fingerprint

The TLS fingerprint point is the crux of it. Every TLS client (the code that
negotiates an HTTPS connection) has a distinguishable "fingerprint" — the
exact set of cipher suites, extensions, and ordering it offers during the
TLS handshake. Real Chrome has one fingerprint. Python's `requests` library
has a different, very recognizable one. Android's default HTTP stack
(`HttpURLConnection` / OkHttp without special configuration) has yet another.
TikTok's defense checks this fingerprint and rejects/challenges anything that
doesn't look like a real mainstream browser, regardless of what User-Agent
header you send (headers are easy to fake; the TLS handshake itself is not,
unless you specifically engineer it to match).

## What we already tried, and proved works (on a PC, not yet on Android)

We used `yt-dlp` (the well-known open-source video-downloader tool, actively
maintained, used by millions) on a Windows PC to test two real TikTok links
the user provided:
- `https://www.tiktok.com/@itzsimpledudez/video/7703445499034029325`
- `https://vt.tiktok.com/ZSgKWwaLh/` (a shortlink)

Both succeeded completely — full video download, no errors. The debug log
showed why: `yt-dlp` was using a library called `curl_cffi`, which does real
TLS fingerprint impersonation (it makes the HTTP client's TLS handshake look
exactly like a real Chrome browser's handshake, byte for byte). The debug
output literally said `Impersonation target: chrome-152:windows-10`.

## What fails, and why

We embedded a library called `yt-dlp-android` (by `ffmpegkit-maintained`,
`dev.ffmpegkit-maintained:yt-dlp-android:2.0.2` on Maven Central) into the
Android app. It runs real Python + yt-dlp inside the Android app via a
bridge called Chaquopy. This is the **free tier** of that library. When we
tested the exact same two links through the Android app, both failed with:

```
ERROR: [TikTok] <video_id>: Unexpected response from webpage request
```

We confirmed via the library's own README/limitations table that this is
because the **free tier does not include `curl_cffi`** — TLS impersonation
is explicitly gated to their **paid Pro tier** ($24 one-time for individual
license, per their pricing). The free tier uses "Python's default HTTP
stack," which has a recognizable, non-browser TLS fingerprint, which TikTok's
defense flags and serves the challenge page to. This matches our PC test
findings exactly: same tool, same extractor logic, the only difference is
TLS impersonation being present (PC, success) vs absent (Android free tier,
failure).

**So the fix is specifically and only about the TLS handshake fingerprint,
not about the HTTP logic, not about headers, not about the extraction
algorithm.**

## What we also already built ourselves (and proved works, partially)

Before settling on yt-dlp, we reverse-engineered TikTok's actual challenge
system by reading real `yt-dlp` source code (its TikTok extractor module) and
reimplemented the logic natively in Kotlin:

1. Fetch the TikTok post's web page.
2. If it returns the short "challenge" page instead of the real page: that
   page embeds a base64-encoded JSON blob containing a SHA-256 hash puzzle —
   essentially "find an integer N such that `sha256(sha256(secretA) + N)`
   equals `secretB`" (both secrets are given in the page, base64'd). This
   requires brute-forcing N starting from 0; the true answer is almost always
   found within a few hundred thousand iterations, which is near-instant on
   a phone CPU because it's pure SHA-256, no real cryptography puzzle
   difficulty.
3. Once solved, set a specific cookie (the solved answer, re-encoded) and
   re-request the same page. This time it should return the *real* page,
   containing a large embedded JSON object
   (`__UNIVERSAL_DATA_FOR_REHYDRATION__`) with the direct video URL, caption,
   author, duration, and subtitle track URLs if present.
4. Download the actual video file from that direct URL, with a `Referer:
   https://www.tiktok.com/` header (without this header, the video CDN
   returns HTTP 403).

**We tested this entire pipeline on a PC in Python (simulating what the
Kotlin code would do) and it worked end to end** — solved the challenge,
got the real page, extracted a real playable video URL, downloaded an actual
3.3MB video file successfully. This was done using Python's `curl_cffi`
library for the TLS impersonation step (step 1), which is what made it work
on the PC. We wrote actual Kotlin code implementing steps 2-4 and it compiled
successfully, but we have never been able to run it on a real Android phone,
and we deleted it out of caution (see below) before testing it there.

**Why we deleted our own Kotlin implementation:** at the time, we weren't
confident we'd distinguished between "the challenge-solving logic is
proven" (it is — we tested it in Python and it works) versus "the whole
pipeline is proven on Android" (it isn't — TLS impersonation on Android is
the unverified part). We erred on the side of caution and removed it rather
than ship something partially unverified. In retrospect we may have been too
hasty — the challenge-solving and parsing logic itself is sound; only the
Android-side TLS impersonation piece is the genuine remaining unknown.

## The actual open question: how do you get real browser TLS fingerprinting on Android, for free, without a third-party paid license?

This is the one piece neither we nor the free yt-dlp-android library have
solved. Candidate approaches, as far as we understand them (please correct
or expand on any of this):

### Option A: Google's Cronet library
Cronet is Google's packaging of Chromium's actual networking stack as a
standalone library, used inside Chrome itself and distributed via Google
Play Services (`com.google.android.gms:play-services-cronet` or the
standalone `org.chromium.net:cronet-embedded` artifact). Because it's
literally Chromium's real network code, a request made through Cronet
should produce a genuine Chrome TLS handshake — not an imitation of one,
the actual thing Chrome would send. This seems like the most promising
free, on-device path, but we have not implemented or tested it. Open
questions: does it integrate cleanly with OkHttp/Android's networking
patterns for a React Native native module? Does Google Play Services
availability (not all Android devices/builds have it) matter for a general
consumer app? What's the APK size cost? Does it actually produce a
fingerprint indistinguishable from real Chrome in practice, or does TikTok's
detection catch something else about it?

### Option B: Pay for the yt-dlp-android Pro tier
$24 one-time (individual license) adds `curl_cffi` to the same library
we're already using. Fastest path, proven mechanism (we already confirmed
curl_cffi-based impersonation works on PC), but recurring dependency on a
third-party commercial library, and doesn't teach us anything reusable.

### Option C: Move extraction server-side
Run yt-dlp (with curl_cffi, free on a normal server/Linux environment — the
Pro restriction is specific to the Android packaging, not curl_cffi itself)
on a backend we control. The app sends the TikTok link to our server; the
server does the extraction and returns a direct video URL or streams the
file back. This was already identified as the right long-term architecture
for scaling (centralized maintenance when TikTok changes something, no APK
bloat from embedding Python), but introduces hosting costs and shifts the
privacy story (video briefly passes through a server we run, rather than
staying fully on-device). This is intended as a later-stage solution, not
a right-now fix.

### Option D: Cookie-based workaround (free tier's own suggested fallback)
The free yt-dlp-android library suggests manually exporting TikTok session
cookies as a workaround for sites that block non-browser fingerprints. This
would mean asking users to somehow extract their TikTok cookies (e.g. via a
WebView login flow) and feeding them to the extractor. Fragile (cookies
expire, require re-auth), bad UX for a consumer app, not seriously
considered a good path but mentioned for completeness.

## What we want help figuring out

1. **Is Cronet actually viable for this?** Will a Cronet-based HTTP request
   from an Android app genuinely produce a browser-indistinguishable TLS
   fingerprint in practice, enough to pass TikTok's current detection? Are
   there known gotchas, integration patterns (especially combined with a
   custom cookie jar and header control, which our pipeline needs), or
   reasons this wouldn't work that we're not aware of?
2. **Is there a better/simpler free approach to TLS fingerprint
   impersonation on Android** that we haven't considered? (e.g., a specific
   OkHttp interceptor configuration, a different open-source library, a way
   to shell out to a bundled binary that already does this, etc.)
3. **Given the tradeoffs above, which approach would you actually
   recommend** for a small team shipping a real consumer SaaS app, balancing
   development time, ongoing cost, reliability, and the fact that this is
   fundamentally a cat-and-mouse problem (TikTok will change its defenses
   again eventually, regardless of which approach we pick now)?
4. Any other blind spots in our understanding of the problem that we should
   know about before committing engineering time to one of these paths?

## Context on constraints

- Android app, React Native 0.88, native modules in Kotlin.
- Must work without the user manually downloading/uploading video files —
  that is the whole point of the "paste a link" feature; the manual-file
  path already exists and works as a permanent fallback regardless.
- Small team / solo-ish project, cost-sensitive but not zero-budget (a
  one-time $24 license is trivial; ongoing server hosting costs are a real
  factor to weigh, not a blocker).
- Currently no backend/server exists for this app at all — everything is
  on-device. Standing up a server is being treated as a future scaling
  step, not something to avoid in principle.
- Legal/ToS exposure around scraping TikTok is understood as a real
  consideration but is being treated as a business/policy decision for
  later, not the focus of this specific technical question.
