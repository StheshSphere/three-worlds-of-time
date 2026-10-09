MODERN-LAB AUDIO — expected files (Member 2, Lab audio pass)
==============================================================

Drop the seven files below into this folder, exact lowercase-hyphen
names, .ogg format (the game requests them case-sensitively; on the
Linux LAMP server a wrong case = 404). Until a file exists the game
plays the shared sound set only — no console errors, no crash.

  keypad-ok.ogg       short confirmation beep — Archive keypad accepts the code
  keypad-deny.ogg     denied buzz — wrong code on the keypad
  breaker-ok.ogg      click/hum-up — a conduit rotation connects more power
  breaker-deny.ogg    harsh buzz — a rotation cuts the flow (wrong input)
  power-restored.ogg  rising power-on cue when the grid accepts the route
                      (plays together with the shared "power-up" jingle)
  core-pickup.ogg     short take cue when grabbing the Lab Core
                      (plays under the shared "core-get" fanfare)
  generator-hum.ogg   seamless looping electrical hum, MONO, ~4-10 s —
                      positional: one loop per emergency generator in the
                      power room; falls silent when power is restored

Suggested sources: Kenney (kenney.nl, CC0) Sci-Fi Sounds / Interface
Sounds, or freesound.org with a CC0/CC-BY licence — record the actual
source in the game Credits when adding files (Chunk 6 adds the entry).

Room ambience is NOT a file: the Lab's electrical room-tone is Member 1's
synthesised era ambience (mains hum + AC hiss) in src/core/audio.js —
era-scoped, gesture-gated, fades out when the Future loads.
