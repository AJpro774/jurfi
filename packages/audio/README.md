# @jurfi/audio

See docs/api/input-audio-perf.md.

## Additions

- `audio.playTone({ frequency, duration, type, volume, bus, fadeOut, priority })`: oscillator + gain envelope on a bus.
  Returns `Voice | null` (shares the voice limit/priority stealing with `play`).

## Muted mode

When muted (`muted: true`, or the URL has `?test=1`) the engine **still creates an `AudioContext`** and all buses/nodes;
only the master gain is 0. Voices are still allocated and returned. Inject `createContext` to supply a fake context.
