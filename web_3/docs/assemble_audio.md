# Drifter 2077 — Audio Assembler (`scripts/assemble_audio.py`)

Deferred-local step that turns a `ready` episode's Suno output into the final
long-form audio track (to be muxed with the pixel loop video later).

## What it does
1. Reads the episode from Neon (`dr_episodes.audio`, `ambient_bed_audio`) and
   `dr_channel_config.crossfade_sec` — same DSN the Python worker uses.
2. Picks each track's **primary clip** (`primaryClipIndex`, set by `suno.ts`;
   override-able from the dashboard) in playlist order (`specIndex` 0..19).
3. Downloads clips into `dr_e{id}/Download/audio/` (RUN_VEO-style folder).
4. ffmpeg:
   - `acrossfade` the primary clips pairwise (`d=crossfade_sec`, default 3s).
   - Loop the dedicated **ambient bed** track (`specIndex = -1`) under the mix at
     a low gain (`--bed-gain-db`, default −18 dB) via `amix ... normalize=0`.
   - `loudnorm=I=-14:TP=-1:LRA=11` on the final file.
5. Writes `dr_e{id}/Download/audio/dr_e{id}_final_audio.mp3`.

## Run
```bash
pip install asyncpg          # one-time
python3 web_3/scripts/assemble_audio.py <episode_id>
# options: --out DIR  --crossfade SEC  --bed-gain-db DB
```
Requires `ffmpeg` on PATH. `DATABASE_URL` is read from env or `web_3/.env.local`.

## Contracts / notes
- **Chapter sync:** the YouTube chapters in `dr_episodes.yt_chapters` are computed
  with the SAME `crossfade_sec` (see `descriptionBuilder.buildChaptersFromAudio`),
  so timestamps line up with this output. Changing `--crossfade` here without
  matching `dr_channel_config.crossfade_sec` will desync chapters.
- **Ambient bed source:** a dedicated per-episode Suno generation (code-built from
  `ambient_sound_map`), not a fixed asset — so the bed matches the scene. Suno may
  still sneak musical elements in; pick a different `primaryClipIndex` for the bed
  from the dashboard if needed.
- Idempotent downloads (skips files already present). Re-running re-encodes only.
- Video muxing (pixel loop × this audio) remains a separate deferred step.
