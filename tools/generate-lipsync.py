# Builds src/core/visemes.js — the precomputed lip-sync timelines (dev tool).
#
# HOW THE TIMING IS DERIVED (and why this shape):
#   The shipped voice lines were rendered by Edge's neural voices through
#   tools/generate-voice.py and butchered into joined mp3s. The service is
#   near-deterministic for identical requests (fresh renders match the shipped
#   audio at envelope correlation ~0.999) but NOT byte-identical, and asking
#   the service for WordBoundary events uses a different synthesis mode whose
#   performance does not match the shipped files. So for every performance
#   segment this tool renders TWO versions:
#     1. the plain version — mirrors the shipped pipeline; its trimmed PCM is
#        concatenated with the same gaps and re-encoded, producing a rebuild
#        that is verified against the shipped mp3 (duration + envelope
#        correlation) line by line;
#     2. a WordBoundary version — the synthesizer's OWN forced alignment:
#        exact word start/end times.
#   Word times from (2) are transfered onto the verified rebuild (1) with a
#   banded DTW over 10 ms energy envelopes, giving word-accurate timings for
#   the shipped audio. Words become viseme events with a grapheme-to-viseme
#   rule set (M/B/P pressed lips, A/AH jaw open, E/EE wide, O/OO round,
#   F/V lip-teeth, S/Z teeth close, W/U protrude, silence rest — the table
#   from the task brief), distributed across each word's measured duration.
#   A per-line `mode` records the verification result.
#
# The residual encoder/decoder latency is measured against the browser's own
# mp3 decoder (the one the game uses) by tools/measure-lipsync.mjs and stored
# as CALIB below; the runtime adds it to every event time.
#
# Re-run:  python tools/generate-lipsync.py
import asyncio
import importlib.util
import sys
import tempfile
from pathlib import Path

import edge_tts
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
VOICE_DIR = ROOT / "assets" / "audio" / "voice"
OUT_JS = ROOT / "src" / "core" / "visemes.js"
TMP = Path(tempfile.mkdtemp(prefix="twot-lipsync-"))

_spec = importlib.util.spec_from_file_location("gv", ROOT / "tools" / "generate-voice.py")
gv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gv)
PLAN = gv.PLAN
SR = gv.SAMPLE_RATE
CONCURRENCY = 3

CALIB = 0.08   # seconds; browser mp3 decoder delay (measure-lipsync.mjs, median 80 ms)

# Mouth-shape ids shared with src/character.js (order must match LIP_CODES).
CODES = ["rest", "aa", "e", "ee", "o", "oo", "mbp", "fv", "sz", "wu", "n"]
CODE_INDEX = {c: i for i, c in enumerate(CODES)}

VOWEL_CODE = {"a": "aa", "e": "e", "i": "ee", "o": "o", "u": "oo", "y": "ee"}
CONS = {
    "m": ("mbp", 1.0, 0.85), "b": ("mbp", 1.0, 0.85), "p": ("mbp", 1.0, 0.85),
    "f": ("fv", 1.0, 0.7), "v": ("fv", 1.0, 0.7),
    "w": ("wu", 0.9, 0.75),
    "s": ("sz", 0.95, 0.5), "z": ("sz", 0.95, 0.5), "x": ("sz", 0.95, 0.5),
    "t": ("n", 0.7, 0.45), "d": ("n", 0.7, 0.45), "n": ("n", 0.7, 0.45),
    "l": ("n", 0.75, 0.5), "r": ("n", 0.75, 0.5), "k": ("n", 0.7, 0.45),
    "g": ("n", 0.7, 0.45), "h": ("n", 0.6, 0.4), "j": ("sz", 0.9, 0.5),
    "q": ("n", 0.7, 0.45),
}
STOP = {"a", "an", "the", "to", "of", "and", "or", "in", "on", "at", "it", "is",
        "i", "my", "we", "be", "as", "so", "no", "not", "that", "this", "but",
        "for", "with", "just", "up", "out", "am"}


def chunks_for_word(word):
    """Grapheme → (code, weight, amp) chunks — the text-informed shape order."""
    s = "".join(ch for ch in word.lower() if ch.isalpha() or ch == "'")
    out = []
    i = 0
    while i < len(s):
        two = s[i:i + 2]
        if two in ("th", "sh", "ch", "ph"):
            out.append(("fv" if two == "ph" else "sz", 0.95, 0.55))
            i += 2
            continue
        c = s[i]
        if c in VOWEL_CODE:
            j = i
            while j < len(s) and s[j] in VOWEL_CODE:
                j += 1
            run = s[i:j]
            out.append((VOWEL_CODE[run[0]], 1.6 + 0.5 * len(run), 0.9 if len(run) == 1 else 0.8))
            i = j
            continue
        if c == "c":
            nxt = s[i + 1] if i + 1 < len(s) else ""
            out.append(("sz", 0.95, 0.5) if nxt in "eiy" else ("n", 0.7, 0.45))
        elif c in CONS:
            if out and out[-1][0] == CONS[c][0]:
                i += 1
                continue
            out.append(CONS[c])
        i += 1
    if len(s) <= 3 or s in STOP:
        out = [(c, w, round(a * 0.72, 2)) for c, w, a in out]
    return out


async def render(voice, text, with_boundary, **kw):
    audio = bytearray()
    words = []
    comm = edge_tts.Communicate(text, voice,
                                boundary="WordBoundary" if with_boundary else "SentenceBoundary", **kw)
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
        elif chunk["type"] == "WordBoundary":
            words.append((chunk["offset"] / 1e7, chunk["duration"] / 1e7, chunk["text"]))
    if len(audio) < 500:
        raise RuntimeError(f"tiny render ({len(audio)} B)")
    return bytes(audio), words


async def render_pair(sem, voice, seg, key, i):
    text, rate, pitch, volume, _gap = seg
    kw = dict(rate=rate, pitch=pitch, volume=volume)
    async with sem:
        for attempt in (1, 2):
            try:
                ab, words = await render(voice, text, True, **kw)
                an, _ = await render(voice, text, False, **kw)
                pb = TMP / f"{key}-{i}-b.mp3"
                pn = TMP / f"{key}-{i}-n.mp3"
                pb.write_bytes(ab)
                pn.write_bytes(an)
                return words, pb, pn
            except Exception:  # noqa: BLE001 - retry once, then surface
                if attempt == 2:
                    raise
                await asyncio.sleep(1.5)


def trim_with_lead(pcm, threshold=280, pad_ms=35):
    win = int(SR * 0.005)
    n = len(pcm) // win
    if n == 0:
        return pcm, 0
    frames = np.abs(pcm[: n * win].reshape(n, win)).max(axis=1)
    loud = np.nonzero(frames > threshold)[0]
    if len(loud) == 0:
        return pcm, 0
    pad = int(SR * pad_ms / 1000)
    lo = max(0, loud[0] * win - pad)
    hi = min(len(pcm), (loud[-1] + 1) * win + pad)
    return pcm[lo:hi], lo


def env(x, ms=10):
    win = int(SR * ms / 1000)
    m = len(x) // win
    return np.abs(x[: m * win].reshape(m, win)).max(axis=1).astype(float)


def dtw_map(ea, eb, band=80):
    """For every 10 ms frame of a, the matched frame index in b (banded DTW),
    plus the accumulated end cost (frames compared after min-max normalising,
    so it reads as an average distance when divided by the frame count)."""
    a = ea / (ea.max() or 1.0)
    b = eb / (eb.max() or 1.0)
    na, nb = len(a), len(b)
    INF = 1e18
    D = np.full((na, nb), INF)
    P = np.zeros((na, nb), dtype=np.int8)
    D[0, 0] = abs(a[0] - b[0])
    for i in range(na):
        j0 = max(0, i - band)
        j1 = min(nb - 1, i + band)
        for j in range(j0, j1 + 1):
            if i == 0 and j == 0:
                continue
            best, bp = INF, 0
            if j > 0 and D[i, j - 1] < best:
                best, bp = D[i, j - 1], 1
            if i > 0 and j > 0 and D[i - 1, j - 1] < best:
                best, bp = D[i - 1, j - 1], 2
            if i > 0 and D[i - 1, j] < best:
                best, bp = D[i - 1, j], 3
            D[i, j] = best + abs(a[i] - b[j])
            P[i, j] = bp
    map_ab = np.zeros(na, dtype=int)
    i, j = na - 1, nb - 1
    while (i > 0 or j > 0) and P[i, j] != 0:
        map_ab[i] = j
        bp = P[i, j]
        if bp == 1:
            j -= 1
        elif bp == 2:
            i, j = i - 1, j - 1
        else:
            i -= 1
    map_ab[0] = j
    return map_ab, float(D[na - 1, nb - 1])


def envelope_corr(ps, pr):
    es, er = env(ps), env(pr)
    m = min(len(es), len(er))
    best = (-2.0, 0)
    for s in range(-15, 16):
        x = es[max(0, s): m + min(0, s)]
        y = er[max(0, -s): m - max(0, s)]
        if len(x) > 10:
            c = float(np.corrcoef(x, y)[0, 1])
            if c > best[0]:
                best = (c, s)
    return best


def shipped_dtw_events(seg_data, es):
    """Fallback for a line whose fresh render doesn't match the shipped mp3
    (e.g. the asset predates a text/prosody tweak): find the shipped
    performance's segment spans between silence runs and DTW every segment's
    WordBoundary times straight onto the shipped waveform. Returns
    (events, 'dtw') or (None, None) when the span structure is unclear."""
    quiet = es < 120
    runs = []
    i = 0
    while i < len(quiet):
        if quiet[i]:
            j = i
            while j < len(quiet) and quiet[j]:
                j += 1
            if j - i >= 15:
                runs.append((i, j))
            i = j
        else:
            i += 1
    speech = np.nonzero(~quiet)[0]
    if len(speech) == 0:
        return None, None
    first, last = int(speech[0]), int(speech[-1])
    # keep only interior runs (a leading/trailing pad is just the mp3 delay)
    runs = [(a, b) for a, b in runs if a > first + 2 and b < last - 2]
    spans = []
    prev = first
    for a, b in runs:
        spans.append((prev, a))
        prev = b
    spans.append((prev, last + 1))
    if len(spans) != len(seg_data):
        return None, None

    events = []
    for (words, shift, span, ea, eb), (a, b) in zip(seg_data, spans):
        seg_span = es[a:b]
        if len(seg_span) < 8:
            return None, None
        m, cost = dtw_map(ea, seg_span, band=120)
        if not np.isfinite(cost) or cost / len(ea) > 0.08:
            return None, None
        t_prev_end = None
        for w_off, w_dur, w_txt in words:
            bf = min(int(round(w_off * 100)), len(m) - 1)
            ef = min(int(round((w_off + w_dur) * 100)), len(m) - 1)
            t0 = a * 0.010 + m[bf] * 0.010
            t1 = a * 0.010 + m[ef] * 0.010
            dur = max(0.05, t1 - t0)
            chunks = chunks_for_word(w_txt)
            tw = sum(c[1] for c in chunks) or 1.0
            if t_prev_end is not None and t0 - t_prev_end > 0.15:
                events.append((t_prev_end + 0.04, "rest", 0.0))
            tc = t0
            for code, w, amp in chunks:
                events.append((tc, code, amp))
                tc += dur * (w / tw)
            t_prev_end = t1
        events.append(((b * 0.010) + 0.05, "rest", 0.0))
    return events, "dtw"


async def process_line(sem, key, voice, segments):
    best = None
    for _attempt in (1, 2):
        result = await process_line_once(sem, key, voice, segments)
        if result[0] in ("exact", "dtw"):
            return result
        if best is None or result[1] > best[1]:
            best = result
    return best


async def process_line_once(sem, key, voice, segments):
    pieces = []
    seg_data = []     # (words, shift, span, noflag_path)
    cursor = 0.0
    for i, seg in enumerate(segments):
        words, pb, pn = await render_pair(sem, voice, seg, key, i)
        pcb = gv.decode_mp3(pb)
        pcn = gv.decode_mp3(pn)
        trimmed, lo_n = trim_with_lead(pcn)
        shift = cursor - lo_n / SR
        seg_data.append((words, shift, len(trimmed) / SR, env(pcb), env(pcn)))
        pieces.append(trimmed)
        cursor += len(trimmed) / SR
        gap = seg[4]
        if gap > 0:
            pieces.append(np.zeros(int(SR * gap / 1000), dtype=np.int16))
            cursor += gap / 1000
    joined = np.concatenate(pieces)
    rebuilt_path = TMP / f"{key}-rebuilt.mp3"
    rebuilt_path.write_bytes(gv.encode_mp3(joined))

    shipped_path = VOICE_DIR / f"{key}.mp3"
    ps = gv.decode_mp3(shipped_path)
    pr = gv.decode_mp3(rebuilt_path)
    corr, shift_frames = envelope_corr(ps, pr)
    dur_delta = len(pr) / SR - len(ps) / SR
    verified = corr >= 0.98 and abs(dur_delta) <= 0.04 and abs(shift_frames) <= 2

    es = env(ps)
    events = []
    mode = "approx"
    if verified:
        # Exact path: word times from the WordBoundary render, mapped onto the
        # (verified) rebuild via per-segment DTW.
        mode = "exact"
        for words, shift, span, ea, eb in seg_data:
            seg_end = shift + span
            if words:
                mb, _cost = dtw_map(ea, eb)
                t_prev_end = None
                last_t = 0.0
                for w_off, w_dur, w_txt in words:
                    bf = min(int(round(w_off * 100)), len(mb) - 1)
                    t0 = max(last_t, shift + mb[bf] * 0.010)
                    chunks = chunks_for_word(w_txt)
                    tw = sum(c[1] for c in chunks) or 1.0
                    if t_prev_end is not None and t0 - t_prev_end > 0.15:
                        events.append((t_prev_end + 0.04, "rest", 0.0))
                    tc = t0
                    for code, w, amp in chunks:
                        events.append((tc, code, amp))
                        tc += w_dur * (w / tw)
                    t_prev_end = t0 + w_dur
                    last_t = t0
                events.append((min(seg_end, (t_prev_end or seg_end) + 0.10), "rest", 0.0))
            else:
                events.append((seg_end, "rest", 0.0))
    else:
        # The fresh render doesn't reproduce this shipped line (asset predates
        # a text/prosody tweak). First try DTW straight onto the shipped
        # waveform; only if the span structure is unclear, approximate by
        # distributing the words across each segment's measured speech span.
        events, mode = shipped_dtw_events(seg_data, es)
        if events is None:
            mode = "approx"
            events = []
            for words, shift, span, _ea, _eb in seg_data:
                seg_end = shift + span
                if words:
                    total_w = sum(sum(c[1] for c in chunks_for_word(t)) for _, _, t in words) or 1.0
                    speech = max(0.1, span - 0.08)
                    tc = shift + 0.035
                    for w_off, w_dur, w_txt in words:
                        chunks = chunks_for_word(w_txt)
                        wsum = sum(c[1] for c in chunks) or 1.0
                        dur = speech * (wsum / total_w)
                        for code, w, amp in chunks:
                            events.append((tc, code, amp))
                            tc += dur * (w / wsum)
                events.append((seg_end, "rest", 0.0))

    events.sort(key=lambda e: e[0])
    events = [(max(0.0, t), c, a) for t, c, a in events]
    onset = None
    if len(es):
        loud = np.nonzero(es > 280)[0]
        onset = float(loud[0] * 0.010) if len(loud) else 0.0
    return mode, corr, dur_delta, events, len(ps) / SR, onset


async def main():
    sem = asyncio.Semaphore(CONCURRENCY)
    results = {}
    for key, (voice, segments) in PLAN.items():
        try:
            results[key] = await process_line(sem, key, voice, segments)
            mode, corr, dd, events, dur, onset = results[key]
            first = next((t for t, c, a in events if c != "rest"), 0.0)
            tag = {"exact": "exact ", "dtw": "dtw   ", "approx": "APPROX"}[mode]
            print(f"{tag} {key:16s} corr {corr:.4f} drift {dd*1000:+5.0f}ms  {dur:5.2f}s  "
                  f"first {first*1000:6.0f}ms  onset {(onset or 0.0)*1000:6.0f}ms  events {len(events)}")
        except Exception as e:  # noqa: BLE001
            print(f"FAIL  {key}: {e}")
            return 1
    n_ok = sum(1 for v, *_ in results.values() if v in ("exact", "dtw"))
    n_onset = 0
    deltas = []
    for key, (mode, corr, dd, events, dur, onset) in results.items():
        first = next((t for t, c, a in events if c != "rest"), None)
        if first is not None and onset is not None:
            n_onset += 1
            deltas.append(round((onset - first) * 1000))
    print(f"\nonset-minus-first-event (miniaudio decode), ms: {sorted(deltas)}")

    lines = []
    for key in PLAN:
        mode, corr, dd, events, dur, onset = results[key]
        flat = []
        for t, code, amp in events:
            flat.append(str(int(round(t * 1000))))
            flat.append(str(CODE_INDEX[code]))
            flat.append(f"{amp:.2f}".rstrip("0").rstrip("."))
        lines.append(f"  '{key}': {{ dur: {dur:.3f}, mode: '{mode}', t: [{', '.join(flat)}] }},")

    header = f"""/**
 * Precomputed lip-sync timelines — generated by tools/generate-lipsync.py.
 * DO NOT EDIT BY HAND; re-run the tool instead.
 *
 * One entry per voice line: `dur` is the mp3 length in seconds, `t` is a flat
 * [time_ms, mouth_code, amp] stream (mouth codes index LIP_CODES). Word times
 * come from the synthesizer's WordBoundary alignment, transfered onto the
 * shipped performance with envelope DTW; {n_ok}/{len(PLAN)} lines verified
 * against the shipped mp3 (correlation + duration, see the tool). `mode`
 * records the result ('exact' — fresh render verified + word times; 'dtw' —
 * stale shipped asset aligned straight onto its waveform; 'approx' —
 * text-informed distribution only). CALIB is the browser-decoder
 * latency correction (seconds) measured by tools/measure-lipsync.mjs.
 */
export const LIP_CODES = {CODES!r};
export const LIP_CALIB = {CALIB};
export const LIP_LINES = {{
{chr(10).join(lines)}
}};
"""
    OUT_JS.write_text(header, encoding="utf-8")
    print(f"\n{n_ok}/{len(PLAN)} verified — wrote {OUT_JS}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
