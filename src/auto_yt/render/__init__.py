"""Local video-render pipeline for the web/ (哲人の刻) channel.

Turns a finished TTS audio track + a folder of pre-composed character images
into a subtitled slideshow video with ffmpeg. Runs entirely on the local
machine (Vercel can't run ffmpeg); see src/auto_yt/render_worker.py for the
poll loop that drives it.
"""
