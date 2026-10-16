# Generates the voice-acting audio files in assets/audio/voice/ (dev tool).
#
# Voices (Microsoft Edge neural voices via edge-tts, MIT-licensed tool,
# generated ahead-of-time so the shipped game needs no keys/network):
#   Ari       — en-US-AvaMultilingualNeural  (Expressive, Caring, Pleasant — the
#               most emotionally expressive Edge female voice)
#   Prof      — en-US-EmmaMultilingualNeural (Cheerful, Clear, Conversational;
#               same "Emma" identity as before, newer more natural model)
#   Narrator  — en-US-AndrewMultilingualNeural (Warm, Confident, Authentic —
#               a storyteller register, not a documentary monotone)
#
# PERFORMANCE MODEL — each line is a list of segments. Every segment carries its
# own rate / pitch / volume so the SAME line can start hesitantly and end in a
# shout ("I... I think we did it!"). Segments are generated as separate neural
# renders, silence is trimmed off their edges, and they are joined with
# expressive gaps (hesitation 240-520 ms, interruption 80-160 ms) into one mp3.
#
# Text is EXACTLY the dialogue in src/story.js and the levels' api.say lines
# (Roman numerals are voiced as their spoken form, which is what a human actor
# would say; the on-screen text is unchanged).
# Re-run:  python tools/generate-voice.py
import asyncio
import sys
import tempfile
from pathlib import Path

import edge_tts
import lameenc
import miniaudio
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "audio" / "voice"
OUT.mkdir(parents=True, exist_ok=True)
TMP = Path(tempfile.mkdtemp(prefix="twot-voice-"))

ARI = "en-US-AvaMultilingualNeural"
PROF = "en-US-EmmaMultilingualNeural"
NARRATOR = "en-US-AndrewMultilingualNeural"

SAMPLE_RATE = 24000
CONCURRENCY = 3

# segment = (text, rate, pitch, volume, gap_after_ms)
# Rates/volumes are Edge prosody percentages; pitch is an absolute offset in Hz.
# Values were tuned per line: excited/urgent lines push rate + pitch + volume
# up; serious, sad or suspenseful lines drop pitch and slow down; the narrator
# keeps a slow, low storyteller base with dramatic pauses between clauses.

PLAN = {
    # --- Prologue (opening narration + Ari) ---
    "nar-intro": (NARRATOR, [
        ("Chronos Research Facility.", "-8%", "-5Hz", "+0%", 430),
        ("03:07 a.m.", "-8%", "-5Hz", "+0%", 380),
        ("the night of Field Test 7.", "-13%", "-7Hz", "-4%", 0),
    ]),
    "ari-wait": (ARI, [
        ("Professor Adeyemi said to wait for her…", "-7%", "-5Hz", "-8%", 260),
        ("but the hourglass drive is stable.", "+0%", "+2Hz", "+0%", 220),
        ("Just one more test.", "-5%", "+3Hz", "-10%", 0),
    ]),
    "ari-eighty": (ARI, [
        ("Drive at eighty percent…", "-2%", "-2Hz", "+2%", 210),
        ("a hundred…", "+3%", "+4Hz", "+6%", 170),
        ("all three cores holding!", "+9%", "+9Hz", "+12%", 0),
    ]),
    "ari-shutdown": (ARI, [
        ("A hundred and twenty…", "+3%", "+2Hz", "+6%", 160),
        ("a hundred and forty?!", "+11%", "+13Hz", "+18%", 230),
        ("Shut it down —", "+15%", "+8Hz", "+24%", 90),
        ("shut it down!", "+16%", "+10Hz", "+26%", 0),
    ]),
    "ari-cores": (ARI, [
        ("No, no, no —", "+7%", "+8Hz", "+16%", 90),
        ("the cores!", "+10%", "+13Hz", "+22%", 0),
    ]),
    "nar-shattered": (NARRATOR, [
        ("The timeline shattered.", "-11%", "-7Hz", "+2%", 500),
        ("Its three cores were flung across time —", "-10%", "-6Hz", "+0%", 340),
        ("into the distant past, into this very night, and into a far future.", "-14%", "-8Hz", "-3%", 0),
    ]),
    # --- Wake-up (the Past) ---
    "ari-where": (ARI, [
        ("Ugh…", "-12%", "-8Hz", "-14%", 330),
        ("where am I?", "-5%", "+2Hz", "-6%", 290),
        ("No —", "+5%", "+5Hz", "+4%", 150),
        ("when am I?", "-2%", "+10Hz", "+2%", 0),
    ]),
    "ari-machine": (ARI, [
        ("The machine came with me…", "-2%", "+0Hz", "+0%", 250),
        ("but its sockets are empty.", "-8%", "-6Hz", "-7%", 0),
    ]),
    "ari-find": (ARI, [
        ("If I can find all three cores, I can put time back together.", "+1%", "+0Hz", "+0%", 230),
        ("That temple looks like a good place to start.", "+0%", "+3Hz", "+0%", 0),
    ]),
    # --- Arrival lines (Present / Future) ---
    "ari-lab": (ARI, [
        ("It worked — I'm back in the lab!", "+8%", "+9Hz", "+9%", 290),
        ("No…", "-10%", "-8Hz", "-9%", 230),
        ("It's still that same night, just after the accident.", "-8%", "-4Hz", "-6%", 0),
    ]),
    "ari-vault": (ARI, [
        ("The power's out and the second core is sealed in the vault.", "+1%", "+0Hz", "+0%", 210),
        ("I need answers — and some light.", "+1%", "+3Hz", "+0%", 0),
    ]),
    "ari-2187": (ARI, [
        ("Too far forward…", "-9%", "-6Hz", "-9%", 310),
        ("This is still the lab — in the year 2187.", "-3%", "+1Hz", "+0%", 250),
        ("The whole skyline is tearing itself apart.", "-9%", "-4Hz", "-5%", 0),
    ]),
    "ari-spire": (ARI, [
        ("The last core is up on that spire.", "+1%", "+0Hz", "+0%", 190),
        ("My gauntlet is humming —", "+0%", "+5Hz", "+0%", 150),
        ("I think I can dash through time now.", "+4%", "+3Hz", "+3%", 0),
    ]),
    # --- Epilogue (closing narration) ---
    "nar-morning": (NARRATOR, [
        ("Morning.", "-10%", "-6Hz", "+0%", 540),
        ("The storm has passed.", "-12%", "-6Hz", "-3%", 0),
    ]),
    "ari-whole": (ARI, [
        ("All three cores, back where they belong…", "-9%", "-4Hz", "-7%", 310),
        ("The hourglass is whole again.", "-6%", "+0Hz", "-5%", 0),
    ]),
    "prof-sensors": (PROF, [
        ("Ari?", "+0%", "+4Hz", "+0%", 230),
        ("The sensors went wild last night — and then everything just… settled.", "+0%", "+0Hz", "+0%", 250),
        ("What on earth happened down there?", "-2%", "+3Hz", "+0%", 0),
    ]),
    "ari-kettle": (ARI, [
        ("Let's just say Field Test 7 was… educational.", "-4%", "+3Hz", "+0%", 310),
        ("Put the kettle on, Professor —", "+0%", "+5Hz", "+0%", 130),
        ("it's a long story.", "-5%", "+2Hz", "-6%", 0),
    ]),
    "nar-harmony": (NARRATOR, [
        ("Past, present and future hum in harmony once more.", "-12%", "-6Hz", "+0%", 430),
        ("But time remembers every step you took.", "-14%", "-9Hz", "-3%", 0),
    ]),
    # --- The Past: in-game lines (src/levels/ancientRuins.js) ---
    "ari-plates": (ARI, [
        ("Two glowing plates by that gate… and two heavy carved blocks.", "-3%", "+1Hz", "+0%", 250),
        ("If I push the blocks onto the plates, maybe the gate will open.", "+0%", "+3Hz", "+0%", 0),
    ]),
    "ari-gate-open": (ARI, [
        ("It worked — the gate is open!", "+9%", "+10Hz", "+11%", 210),
        ("There's sunlight pouring into the next court.", "+0%", "+5Hz", "+0%", 0),
    ]),
    "ari-beam": (ARI, [
        ("That beam comes through the round window.", "+0%", "+3Hz", "+0%", 210),
        ("If I turn those bronze mirrors, I can bounce it onto the crystal by the cliff.", "+1%", "+0Hz", "+0%", 0),
    ]),
    "ari-bridge": (ARI, [
        ("Whoa —", "+3%", "+7Hz", "+6%", 150),
        ("stones are rising out of the chasm!", "+9%", "+10Hz", "+11%", 160),
        ("A bridge!", "+9%", "+12Hz", "+13%", 0),
    ]),
    "ari-tablet1": (ARI, [
        ("A carving —", "-3%", "+3Hz", "+0%", 190),
        ("a symbol and a number.", "+1%", "+3Hz", "+0%", 210),
        ("This must be part of some kind of code.", "+3%", "+5Hz", "+2%", 0),
    ]),
    "ari-tablets3": (ARI, [
        ("That's all three tablets.", "+4%", "+5Hz", "+4%", 230),
        ("Now I just need to find what they unlock.", "+1%", "+0Hz", "+0%", 0),
    ]),
    "ari-altar-need": (ARI, [
        ("Three drums, three hours…", "-4%", "+0Hz", "+0%", 270),
        ("I need the symbols from all three tablets to know how to set them.", "+0%", "+0Hz", "+0%", 0),
    ]),
    "ari-altar-set": (ARI, [
        ("Three drums —", "+3%", "+3Hz", "+0%", 170),
        ("I'll set them to match the tablets: hour one, two, then three.", "+0%", "+0Hz", "+0%", 0),
    ]),
    # --- The Present: in-game lines (src/levels/modernLab.js) ---
    "ari-ink": (ARI, [
        ("Pitch black…", "-9%", "-6Hz", "-9%", 330),
        ("If the professor really wrote the code in phosphor ink, my flashlight should pick it up.", "+0%", "+0Hz", "+0%", 0),
    ]),
    "ari-console": (ARI, [
        ("The main power console.", "+2%", "+1Hz", "+0%", 210),
        ("If I can get the current flowing to the vault, everything should come back on.", "+1%", "+0Hz", "+0%", 0),
    ]),
    "ari-powered": (ARI, [
        ("Power's back!", "+9%", "+10Hz", "+11%", 250),
        ("The vault should be open now — east side of the hall.", "+1%", "+0Hz", "+0%", 0),
    ]),
}


def decode_mp3(path):
    """Decode an mp3 to a mono int16 numpy array at SAMPLE_RATE."""
    dec = miniaudio.decode_file(
        str(path),
        output_format=miniaudio.SampleFormat.SIGNED16,
        nchannels=1,
        sample_rate=SAMPLE_RATE,
    )
    return np.frombuffer(dec.samples, dtype=np.int16).copy()


def trim_silence(pcm, threshold=280, pad_ms=35):
    """Trim leading/trailing near-silence, keeping a short natural pad."""
    win = int(SAMPLE_RATE * 0.005)
    n = len(pcm) // win
    if n == 0:
        return pcm
    frames = np.abs(pcm[: n * win].reshape(n, win)).max(axis=1)
    loud = np.nonzero(frames > threshold)[0]
    if len(loud) == 0:
        return pcm
    pad = int(SAMPLE_RATE * pad_ms / 1000)
    lo = max(0, loud[0] * win - pad)
    hi = min(len(pcm), (loud[-1] + 1) * win + pad)
    return pcm[lo:hi]


def encode_mp3(pcm):
    enc = lameenc.Encoder()
    enc.set_bit_rate(48)
    enc.set_in_sample_rate(SAMPLE_RATE)
    enc.set_channels(1)
    enc.set_quality(3)
    data = enc.encode(pcm.astype(np.int16).tobytes()) + enc.flush()
    return bytes(data)


async def render_segment(sem, voice, seg, path):
    text, rate, pitch, volume, _gap = seg
    async with sem:
        for attempt in (1, 2):
            try:
                await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume).save(str(path))
                if path.stat().st_size > 500:
                    return
                raise RuntimeError(f"tiny file ({path.stat().st_size} B)")
            except Exception:  # noqa: BLE001 - retry once, then surface
                if attempt == 2:
                    raise
                await asyncio.sleep(1.5)


async def render_line(sem, key, voice, segments):
    pieces = []
    for i, seg in enumerate(segments):
        seg_path = TMP / f"{key}-{i}.mp3"
        await render_segment(sem, voice, seg, seg_path)
        pcm = trim_silence(decode_mp3(seg_path))
        pieces.append(pcm)
        gap = seg[4]
        if gap > 0:
            pieces.append(np.zeros(int(SAMPLE_RATE * gap / 1000), dtype=np.int16))
    joined = np.concatenate(pieces)
    dest = OUT / f"{key}.mp3"
    dest.write_bytes(encode_mp3(joined))
    return len(segments), dest.stat().st_size, len(joined) / SAMPLE_RATE


async def main() -> int:
    sem = asyncio.Semaphore(CONCURRENCY)
    failed = []
    total_segs = 0
    for key, (voice, segments) in PLAN.items():
        try:
            n, size, dur = await render_line(sem, key, voice, segments)
            total_segs += n
            print(f"ok    {key:16s} {voice:30s} {n} seg  {dur:5.2f}s  {size:7d} B")
        except Exception as e:  # noqa: BLE001 - report and continue with the rest
            failed.append(key)
            print(f"FAIL  {key}: {e}")
    if failed:
        print(f"\n{len(failed)} line(s) failed: {', '.join(failed)}")
        return 1
    print(f"\nAll {len(PLAN)} lines ({total_segs} performance segments) generated in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
