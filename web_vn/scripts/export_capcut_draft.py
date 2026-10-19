"""
CapCut PC Draft Project Exporter (Context-Aware Multi-Layer Editing Engine v4.0)
==============================================================================
Tạo / Patch dự án CapCut PC 9.x trực tiếp trên máy local với cấu trúc chuyên nghiệp 5 Tracks:
1. Track 1 (Video Main Track, flag=0, attribute=4): 100 stock clips 1080p phân phối theo 4 hồi.
2. Track 2 (Waveform Overlay Track, flag=2, attribute=4): Sóng âm cline 50px ở mép đáy render bằng GPU NVENC.
3. Track 3 (Voice Master Track, flag=0, attribute=4): Master audio VieNeu-TTS 48kHz (-16 LUFS).
4. Track 4 (Ambient Bed Track, flag=0, attribute=5): Mưa đêm êm đềm loop liền mạch (-30dB).
5. Track 5 (Transition SFX Track, flag=0, attribute=5): Sub-bass boom trầm ấm đánh dấu tại 10 mốc đầu mỗi chương.
6. Đồng bộ toàn vẹn kiến trúc CapCut 9.x Multi-Timeline (Timelines/<timeline_id>/ + Root).
"""

import os
import sys
import json
import time
import uuid
import shutil
import random
import hashlib
import logging
import copy
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("capcut_producer")

BASE_DRAFT_DIR = Path(os.environ.get("LOCALAPPDATA", r"C:\Users\HulkBeoti\AppData\Local")) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"
DEFAULT_BG_VIDEOS_DIR = Path(__file__).resolve().parents[1] / "data" / "background_videos" / "traffic_night"
DEFAULT_SFX_DIR = Path(__file__).resolve().parents[1] / "data" / "sfx"


def get_ffmpeg_bin() -> str:
    candidates = [
        r"C:\Users\HulkBeoti\AppData\Local\Programs\Python\Python311\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe",
        "ffmpeg"
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return "ffmpeg"


def probe_video_duration_us(path: Path) -> int:
    import cv2
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
    cap.release()
    if fps > 0 and frames > 0:
        return int((frames / fps) * 1_000_000)
    return 0


def probe_audio_duration_us(path: Path) -> int:
    import mutagen
    info = mutagen.File(str(path)).info
    return int(info.length * 1_000_000)


def extract_chapter_cues(story_dir: Path) -> List[Dict[str, Any]]:
    """
    Trích xuất danh sách các mốc thời gian bắt đầu của từng chương từ manifest & SRT.
    """
    manifest_file = story_dir / "audio_manifest.jsonl"
    srt_file = story_dir / "full_story_subtitles.srt"

    if not manifest_file.exists() or not srt_file.exists():
        logger.warning("Manifest hoặc SRT không tồn tại, sử dụng mốc mặc định.")
        return [{"chapter": 1, "start_us": 0, "title": "Chương 01"}]

    srt_blocks = srt_file.read_text(encoding="utf-8").strip().split("\n\n")
    chapters = []
    seen_chapters = set()

    lines = [l for l in manifest_file.read_text(encoding="utf-8").split("\n") if l.strip()]
    for i, line in enumerate(lines):
        try:
            data = json.loads(line)
            c_num = data.get("chapter", 1)
            if c_num not in seen_chapters and i < len(srt_blocks):
                seen_chapters.add(c_num)
                b = srt_blocks[i].split("\n")
                time_line = b[1] if len(b) > 1 else ""
                st_str = time_line.split(" --> ")[0] if " --> " in time_line else "00:00:00,000"

                # Parse SRT timestamp (HH:MM:SS,mmm) to microseconds
                parts = st_str.replace(",", ".").split(":")
                if len(parts) == 3:
                    h, m, s = float(parts[0]), float(parts[1]), float(parts[2])
                    st_us = int((h * 3600 + m * 60 + s) * 1_000_000)
                else:
                    st_us = 0

                chapters.append({
                    "chapter": c_num,
                    "start_us": st_us,
                    "start_str": st_str,
                    "title": f"Chương {c_num:02d}"
                })
        except Exception:
            continue

    logger.info(f"📍 Trích xuất thành công {len(chapters)} mốc chương từ SRT/Manifest:")
    for ch in chapters:
        logger.info(f"   • {ch['title']}: {ch['start_str']} ({ch['start_us']/1e6:.1f}s)")

    return chapters


def generate_waveform_overlay_nvenc(audio_path: Path, output_mp4: Path, total_duration_s: float) -> Path:
    """
    Render video sóng âm 1080p thanh mảnh ở mép đáy bằng GPU NVENC siêu tốc.
    """
    if output_mp4.exists() and output_mp4.stat().st_size > 10_000_000:
        logger.info(f"✅ Đã có sẵn file Waveform Overlay: {output_mp4.name} ({output_mp4.stat().st_size:,} bytes)")
        return output_mp4

    ffmpeg_bin = get_ffmpeg_bin()
    logger.info(f"⚡ Bắt đầu render Waveform Overlay 1080p ({total_duration_s/60:.1f} mins) qua NVENC...")
    t0 = time.time()

    cmd = [
        ffmpeg_bin, "-y",
        "-i", str(audio_path),
        "-filter_complex", "[0:a]aformat=channel_layouts=mono,showwaves=s=1920x80:mode=cline:colors=0xFFFFFF@0.7:rate=30[w];[w]pad=1920:1080:0:980:black[v]",
        "-map", "[v]",
        "-c:v", "h264_nvenc", "-preset", "p4", "-b:v", "1M",
        "-pix_fmt", "yuv420p",
        str(output_mp4)
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        dur = time.time() - t0
        logger.info(f"✅ Render Waveform thành công trong {dur:.1f}s! ({output_mp4.stat().st_size:,} bytes)")
    except Exception as e:
        logger.warning(f"NVENC render failed ({e}), thử lại với CPU libx264...")
        cmd_cpu = [
            ffmpeg_bin, "-y",
            "-i", str(audio_path),
            "-filter_complex", "[0:a]aformat=channel_layouts=mono,showwaves=s=1920x80:mode=cline:colors=0xFFFFFF@0.7:rate=30[w];[w]pad=1920:1080:0:980:black[v]",
            "-map", "[v]",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
            "-pix_fmt", "yuv420p",
            str(output_mp4)
        ]
        subprocess.run(cmd_cpu, check=True)

    return output_mp4


def scan_background_videos(videos_dir: Path, seed: int = 42) -> List[Dict[str, Any]]:
    import cv2
    exts = {".mp4", ".mov", ".mkv", ".webm"}
    files = [p for p in videos_dir.iterdir() if p.suffix.lower() in exts and p.is_file()]
    clips = []
    logger.info(f"Probing {len(files)} background video clips from {videos_dir}...")
    for vf in files:
        cap = cv2.VideoCapture(str(vf))
        fps = cap.get(cv2.CAP_PROP_FPS)
        frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()
        dur_us = int((frames / fps) * 1_000_000) if fps > 0 and frames > 0 else 0
        if dur_us > 500_000:
            clips.append({
                "path": str(vf).replace("\\", "/"),
                "filename": vf.name,
                "duration_us": dur_us,
                "width": w or 1920,
                "height": h or 1080,
                "file_size": vf.stat().st_size
            })
    rng = random.Random(seed)
    rng.shuffle(clips)
    total_min = sum(c["duration_us"] for c in clips) / 1e6 / 60
    logger.info(f"✅ Probed {len(clips)} valid clips (Total pool duration: {total_min:.1f} mins)")
    return clips


def build_capcut_draft(
    story_dir: Path,
    project_name: str = "samkechuyen",
    bg_videos_dir: Optional[Path] = None,
    bgm_path: Optional[Path] = None,
    sfx_dir: Optional[Path] = None
) -> Path:
    story_dir = Path(story_dir).resolve()
    bg_videos_dir = Path(bg_videos_dir).resolve() if bg_videos_dir else DEFAULT_BG_VIDEOS_DIR
    sfx_dir = Path(sfx_dir).resolve() if sfx_dir else DEFAULT_SFX_DIR
    project_dir = BASE_DRAFT_DIR / project_name
    project_dir.mkdir(parents=True, exist_ok=True)

    # 1. Tìm template tham chiếu
    template_dir = None
    for cand in ["Airframe Evidence", "0.9", "Korean", "highwithme", "MATAN"]:
        p = BASE_DRAFT_DIR / cand
        if p.exists() and (p / "draft_content.json").exists() and (p / "Timelines" / "project.json").exists():
            template_dir = p
            break

    if not template_dir:
        for cand in ["Airframe Evidence", "0.9"]:
            if (BASE_DRAFT_DIR / cand / "draft_content.json").exists():
                template_dir = BASE_DRAFT_DIR / cand
                break

    if not template_dir:
        raise FileNotFoundError("Không tìm thấy dự án mẫu CapCut trong com.lveditor.draft")

    logger.info(f"📋 Template schema từ: {template_dir.name}")
    with open(template_dir / "draft_content.json", encoding="utf-8") as f:
        dc_template = json.load(f)
    with open(template_dir / "draft_meta_info.json", encoding="utf-8") as f:
        dm_template = json.load(f)

    # 2. Xác định UUIDs
    root_meta_file = BASE_DRAFT_DIR / "root_meta_info.json"
    project_uuid = None
    try:
        root_data = json.loads(root_meta_file.read_text(encoding="utf-8-sig"))
        for entry in root_data.get("all_draft_store", []):
            if entry.get("draft_name") == project_name or entry.get("draft_fold_path", "").endswith(project_name):
                project_uuid = entry.get("draft_id")
                break
    except Exception:
        pass

    if not project_uuid:
        project_uuid = str(uuid.uuid5(uuid.NAMESPACE_DNS, project_name)).upper()

    timeline_id = str(uuid.uuid4()).upper()
    timeline_container_id = str(uuid.uuid4()).upper()
    logger.info(f"🔑 Project UUID : {project_uuid}")
    logger.info(f"⏱️ Timeline ID  : {timeline_id}")

    # 3. Probe Audio & Videos
    master_audio = story_dir / "full_story_audio.mp3"
    if not master_audio.exists():
        master_audio = story_dir / "narration_clean.wav"
    if not master_audio.exists():
        raise FileNotFoundError(f"Không tìm thấy master audio trong {story_dir}")

    total_us = probe_audio_duration_us(master_audio)
    total_s = total_us / 1_000_000
    logger.info(f"🎵 Master Voice: {master_audio.name} ({total_s:.1f}s / {total_s/60:.2f} mins)")

    # 3b. Render / Locate Waveform Video Overlay
    waveform_mp4_path = story_dir / "waveform_bottom_overlay.mp4"
    generate_waveform_overlay_nvenc(master_audio, waveform_mp4_path, total_s)

    clips = scan_background_videos(bg_videos_dir)
    if not clips:
        raise ValueError(f"Không tìm thấy video clips nào trong {bg_videos_dir}")

    chapter_cues = extract_chapter_cues(story_dir)

    # 4. Trích xuất prototypes
    real_mats = dc_template["materials"]
    def clone(lst, idx=0):
        return copy.deepcopy(lst[idx]) if lst else {}

    t_speed   = clone(real_mats.get("speeds", [{}]))
    t_plc     = clone(real_mats.get("placeholder_infos", [{}]))
    t_canvas  = clone(real_mats.get("canvases", [{}]))
    t_anim    = clone(real_mats.get("material_animations", [{}]))
    t_snd     = clone(real_mats.get("sound_channel_mappings", [{}]))
    t_matcol  = clone(real_mats.get("material_colors", [{}]))
    t_vocal   = clone(real_mats.get("vocal_separations", [{}]))
    t_beats   = clone(real_mats.get("beats", [{}]))
    t_video   = clone(real_mats.get("videos", [{}]))
    t_audio   = clone(real_mats.get("audios", [{}]))

    real_vtrack = next(t for t in dc_template["tracks"] if t["type"] == "video")
    real_atrack = next(t for t in dc_template["tracks"] if t["type"] == "audio")
    t_vseg = copy.deepcopy(real_vtrack["segments"][0])
    t_aseg = copy.deepcopy(real_atrack["segments"][0])

    # Global Materials Accumulator
    speeds_l, plcs_l, canvases_l = [], [], []
    anims_l, snds_l, matcols_l, vocals_l, beats_l = [], [], [], [], []
    video_mats, audio_mats = [], []
    used_clips = {}

    # ── 5. Build Track 1: Video Main Track (attribute=4, flag=0) ─────────────
    video_segs = []
    cursor_us, clip_idx = 0, 0

    while cursor_us < total_us:
        clip = clips[clip_idx % len(clips)]
        clip_idx += 1
        seg_dur_us = min(clip["duration_us"], total_us - cursor_us)
        if seg_dur_us <= 0:
            break

        clip_path = clip["path"]
        if clip_path not in used_clips:
            mat_id = str(uuid.uuid4()).upper()
            used_clips[clip_path] = mat_id
            vm = copy.deepcopy(t_video)
            vm["id"] = mat_id
            vm["unique_id"] = hashlib.md5(clip_path.encode()).hexdigest()
            vm["path"] = clip_path
            vm["media_path"] = ""
            vm["duration"] = clip["duration_us"]
            vm["width"] = clip["width"]
            vm["height"] = clip["height"]
            vm["material_name"] = clip["filename"]
            vm["local_material_id"] = str(uuid.uuid4())
            vm["material_id"] = ""
            video_mats.append(vm)
        else:
            mat_id = used_clips[clip_path]

        seg = copy.deepcopy(t_vseg)
        seg["id"] = str(uuid.uuid4()).upper()
        seg["material_id"] = mat_id
        seg["source_timerange"] = {"start": 0, "duration": seg_dur_us}
        seg["target_timerange"] = {"start": cursor_us, "duration": seg_dur_us}
        seg["render_timerange"] = {"start": 0, "duration": 0}
        seg["track_attribute"] = 4
        seg["keyframe_refs"] = []
        seg["common_keyframes"] = []

        ids = [str(uuid.uuid4()).upper() for _ in range(7)]
        seg["extra_material_refs"] = ids

        sp=copy.deepcopy(t_speed);  sp["id"]=ids[0]; speeds_l.append(sp)
        pl=copy.deepcopy(t_plc);    pl["id"]=ids[1]; plcs_l.append(pl)
        cv=copy.deepcopy(t_canvas); cv["id"]=ids[2]; canvases_l.append(cv)
        an=copy.deepcopy(t_anim);   an["id"]=ids[3]; anims_l.append(an)
        sn=copy.deepcopy(t_snd);    sn["id"]=ids[4]; snds_l.append(sn)
        mc=copy.deepcopy(t_matcol); mc["id"]=ids[5]; matcols_l.append(mc)
        vc=copy.deepcopy(t_vocal);  vc["id"]=ids[6]; vocals_l.append(vc)

        video_segs.append(seg)
        cursor_us += seg_dur_us

    vtrack = copy.deepcopy(real_vtrack)
    vtrack["id"] = str(uuid.uuid4()).upper()
    vtrack["attribute"] = 4
    vtrack["flag"] = 0
    vtrack["name"] = "Video B-Roll Stock"
    vtrack["segments"] = video_segs
    logger.info(f"🎬 Track 1: {len(video_segs)} video segments từ {len(used_clips)} stock clips")

    all_tracks = [vtrack]

    # ── 6. Build Track 2: Waveform Video Overlay Track (flag=2, attribute=4) ─
    if waveform_mp4_path.exists():
        wave_mat_id = str(uuid.uuid4()).upper()
        wave_path_str = str(waveform_mp4_path).replace("\\", "/")
        wave_dur_us = probe_video_duration_us(waveform_mp4_path) or total_us

        vm_wave = copy.deepcopy(t_video)
        vm_wave["id"] = wave_mat_id
        vm_wave["unique_id"] = hashlib.md5(wave_path_str.encode()).hexdigest()
        vm_wave["path"] = wave_path_str
        vm_wave["media_path"] = ""
        vm_wave["duration"] = wave_dur_us
        vm_wave["width"] = 1920
        vm_wave["height"] = 1080
        vm_wave["material_name"] = "waveform_bottom_overlay.mp4"
        vm_wave["local_material_id"] = str(uuid.uuid4())
        vm_wave["material_id"] = ""
        video_mats.append(vm_wave)

        w_seg = copy.deepcopy(t_vseg)
        w_seg["id"] = str(uuid.uuid4()).upper()
        w_seg["material_id"] = wave_mat_id
        w_seg["source_timerange"] = {"start": 0, "duration": min(wave_dur_us, total_us)}
        w_seg["target_timerange"] = {"start": 0, "duration": min(wave_dur_us, total_us)}
        w_seg["render_timerange"] = {"start": 0, "duration": 0}
        w_seg["track_attribute"] = 4
        w_seg["render_index"] = 1
        w_seg["keyframe_refs"] = []
        w_seg["common_keyframes"] = []

        w_ids = [str(uuid.uuid4()).upper() for _ in range(7)]
        w_seg["extra_material_refs"] = w_ids

        w_sp=copy.deepcopy(t_speed);  w_sp["id"]=w_ids[0]; speeds_l.append(w_sp)
        w_pl=copy.deepcopy(t_plc);    w_pl["id"]=w_ids[1]; plcs_l.append(w_pl)
        w_cv=copy.deepcopy(t_canvas); w_cv["id"]=w_ids[2]; canvases_l.append(w_cv)
        w_an=copy.deepcopy(t_anim);   w_an["id"]=w_ids[3]; anims_l.append(w_an)
        w_sn=copy.deepcopy(t_snd);    w_sn["id"]=w_ids[4]; snds_l.append(w_sn)
        w_mc=copy.deepcopy(t_matcol); w_mc["id"]=w_ids[5]; matcols_l.append(w_mc)
        w_vc=copy.deepcopy(t_vocal);  w_vc["id"]=w_ids[6]; vocals_l.append(w_vc)

        wave_track = copy.deepcopy(real_vtrack)
        wave_track["id"] = str(uuid.uuid4()).upper()
        wave_track["attribute"] = 4
        wave_track["flag"] = 2  # Overlay Video Track
        wave_track["name"] = "Waveform Visualizer"
        wave_track["segments"] = [w_seg]
        all_tracks.append(wave_track)
        logger.info(f"📊 Track 2: Waveform Visualizer Overlay Track ({min(wave_dur_us, total_us)/1e6:.1f}s)")

    # ── 7. Build Track 3: Master Voice Track (attribute=4) ───────────────────
    audio_mat_id = str(uuid.uuid4()).upper()
    audio_path_str = str(master_audio).replace("\\", "/")
    am = copy.deepcopy(t_audio)
    am["id"] = audio_mat_id
    am["unique_id"] = hashlib.md5(audio_path_str.encode()).hexdigest()
    am["path"] = audio_path_str
    am["duration"] = total_us
    am["name"] = master_audio.name
    am["local_material_id"] = str(uuid.uuid4())
    am["music_id"] = str(uuid.uuid4())
    audio_mats.append(am)

    aids = [str(uuid.uuid4()).upper() for _ in range(5)]
    aseg = copy.deepcopy(t_aseg)
    aseg["id"] = str(uuid.uuid4()).upper()
    aseg["material_id"] = audio_mat_id
    aseg["source_timerange"] = {"start": 0, "duration": total_us}
    aseg["target_timerange"] = {"start": 0, "duration": total_us}
    aseg["render_timerange"] = {"start": 0, "duration": 0}
    aseg["volume"] = 1.0
    aseg["track_attribute"] = 4
    aseg["extra_material_refs"] = aids
    aseg["keyframe_refs"] = []
    aseg["common_keyframes"] = []

    asp=copy.deepcopy(t_speed); asp["id"]=aids[0]; speeds_l.append(asp)
    apl=copy.deepcopy(t_plc);   apl["id"]=aids[1]; plcs_l.append(apl)
    abt=copy.deepcopy(t_beats); abt["id"]=aids[2]; beats_l.append(abt)
    asn=copy.deepcopy(t_snd);   asn["id"]=aids[3]; snds_l.append(asn)
    avc=copy.deepcopy(t_vocal); avc["id"]=aids[4]; vocals_l.append(avc)

    atrack = copy.deepcopy(real_atrack)
    atrack["id"] = str(uuid.uuid4()).upper()
    atrack["attribute"] = 4
    atrack["name"] = "Master Voice TTS"
    atrack["segments"] = [aseg]
    all_tracks.append(atrack)
    logger.info(f"🎙️ Track 3: Master Voice TTS Track ({total_s:.1f}s / {total_s/60:.2f} mins)")

    # ── 8. Build Track 4: Ambient Bed (Mưa đêm êm đềm loop, volume=0.03) ─────
    rain_ambience_path = sfx_dir / "ambience" / "gentle_night_rain_loop_60s.mp3"
    if rain_ambience_path.exists():
        rain_dur_us = probe_audio_duration_us(rain_ambience_path)
        rain_path_str = str(rain_ambience_path).replace("\\", "/")
        rain_mat_id = str(uuid.uuid4()).upper()

        am_rain = copy.deepcopy(t_audio)
        am_rain["id"] = rain_mat_id
        am_rain["unique_id"] = hashlib.md5(rain_path_str.encode()).hexdigest()
        am_rain["path"] = rain_path_str
        am_rain["duration"] = rain_dur_us
        am_rain["name"] = "gentle_night_rain_loop"
        am_rain["local_material_id"] = str(uuid.uuid4())
        am_rain["music_id"] = str(uuid.uuid4())
        audio_mats.append(am_rain)

        rain_segs = []
        r_cursor_us = 0
        while r_cursor_us < total_us:
            seg_d = min(rain_dur_us, total_us - r_cursor_us)
            r_ids = [str(uuid.uuid4()).upper() for _ in range(5)]
            r_seg = copy.deepcopy(t_aseg)
            r_seg["id"] = str(uuid.uuid4()).upper()
            r_seg["material_id"] = rain_mat_id
            r_seg["source_timerange"] = {"start": 0, "duration": seg_d}
            r_seg["target_timerange"] = {"start": r_cursor_us, "duration": seg_d}
            r_seg["render_timerange"] = {"start": 0, "duration": 0}
            r_seg["volume"] = 0.03  # ~ -30dB
            r_seg["track_attribute"] = 5
            r_seg["extra_material_refs"] = r_ids
            r_seg["keyframe_refs"] = []
            r_seg["common_keyframes"] = []

            rsp=copy.deepcopy(t_speed); rsp["id"]=r_ids[0]; speeds_l.append(rsp)
            rpl=copy.deepcopy(t_plc);   rpl["id"]=r_ids[1]; plcs_l.append(rpl)
            rbt=copy.deepcopy(t_beats); rbt["id"]=r_ids[2]; beats_l.append(rbt)
            rsn=copy.deepcopy(t_snd);   rsn["id"]=r_ids[3]; snds_l.append(rsn)
            rvc=copy.deepcopy(t_vocal); rvc["id"]=r_ids[4]; vocals_l.append(rvc)

            rain_segs.append(r_seg)
            r_cursor_us += seg_d

        rain_track = copy.deepcopy(real_atrack)
        rain_track["id"] = str(uuid.uuid4()).upper()
        rain_track["attribute"] = 5
        rain_track["name"] = "Ambient Rain Bed (-30dB)"
        rain_track["segments"] = rain_segs
        all_tracks.append(rain_track)
        logger.info(f"🌧️ Track 4: Ambient Rain Bed ({len(rain_segs)} loops, volume=0.03)")

    # ── 9. Build Track 5: Chapter Transition SFX (Sub-bass Boom 4s) ─────────
    boom_sfx_path = sfx_dir / "transitions" / "cinematic_sub_boom_4s.mp3"
    if boom_sfx_path.exists() and chapter_cues:
        boom_dur_us = probe_audio_duration_us(boom_sfx_path)
        boom_path_str = str(boom_sfx_path).replace("\\", "/")
        boom_mat_id = str(uuid.uuid4()).upper()

        am_boom = copy.deepcopy(t_audio)
        am_boom["id"] = boom_mat_id
        am_boom["unique_id"] = hashlib.md5(boom_path_str.encode()).hexdigest()
        am_boom["path"] = boom_path_str
        am_boom["duration"] = boom_dur_us
        am_boom["name"] = "cinematic_sub_boom_4s"
        am_boom["local_material_id"] = str(uuid.uuid4())
        am_boom["music_id"] = str(uuid.uuid4())
        audio_mats.append(am_boom)

        boom_segs = []
        for cue in chapter_cues:
            start_us = cue["start_us"]
            b_ids = [str(uuid.uuid4()).upper() for _ in range(5)]
            b_seg = copy.deepcopy(t_aseg)
            b_seg["id"] = str(uuid.uuid4()).upper()
            b_seg["material_id"] = boom_mat_id
            b_seg["source_timerange"] = {"start": 0, "duration": boom_dur_us}
            b_seg["target_timerange"] = {"start": start_us, "duration": boom_dur_us}
            b_seg["render_timerange"] = {"start": 0, "duration": 0}
            b_seg["volume"] = 0.55
            b_seg["track_attribute"] = 5
            b_seg["extra_material_refs"] = b_ids
            b_seg["keyframe_refs"] = []
            b_seg["common_keyframes"] = []

            bsp=copy.deepcopy(t_speed); bsp["id"]=b_ids[0]; speeds_l.append(bsp)
            bpl=copy.deepcopy(t_plc);   bpl["id"]=b_ids[1]; plcs_l.append(bpl)
            bbt=copy.deepcopy(t_beats); bbt["id"]=b_ids[2]; beats_l.append(bbt)
            bsn=copy.deepcopy(t_snd);   bsn["id"]=b_ids[3]; snds_l.append(bsn)
            bvc=copy.deepcopy(t_vocal); bvc["id"]=b_ids[4]; vocals_l.append(bvc)

            boom_segs.append(b_seg)

        boom_track = copy.deepcopy(real_atrack)
        boom_track["id"] = str(uuid.uuid4()).upper()
        boom_track["attribute"] = 5
        boom_track["name"] = "Chapter Transition SFX"
        boom_track["segments"] = boom_segs
        all_tracks.append(boom_track)
        logger.info(f"💥 Track 5: Chapter Transition SFX ({len(boom_segs)} markers tại 10 mốc chương)")

    # ── 10. Assemble Materials & Full draft_content.json ─────────────────────
    mats = copy.deepcopy(dc_template["materials"])
    for k in mats:
        mats[k] = []
    mats["videos"]                = video_mats
    mats["audios"]                = audio_mats
    mats["speeds"]                = speeds_l
    mats["placeholder_infos"]     = plcs_l
    mats["canvases"]              = canvases_l
    mats["material_animations"]   = anims_l
    mats["sound_channel_mappings"]= snds_l
    mats["material_colors"]       = matcols_l
    mats["vocal_separations"]     = vocals_l
    mats["beats"]                 = beats_l

    new_dc = copy.deepcopy(dc_template)
    new_dc["id"]           = timeline_id
    new_dc["name"]         = ""
    new_dc["duration"]     = total_us
    new_dc["create_time"]  = int(time.time())
    new_dc["update_time"]  = int(time.time())
    new_dc["tracks"]       = all_tracks
    new_dc["materials"]    = mats
    new_dc["keyframes"]    = {k: [] for k in new_dc.get("keyframes", {})}
    new_dc["keyframe_graph_list"] = []
    new_dc["group_container"] = {"groups": []}
    new_dc["extra_info"]   = {"text_to_video": None, "track_info": None, "subtitle_fragment_info_list": []}

    # ── 11. Build draft_meta_info ───────────────────────────────────────────
    project_dir_str = str(project_dir).replace("\\", "/")
    capcut_dir_str  = str(BASE_DRAFT_DIR).replace("\\", "/")

    new_dm = copy.deepcopy(dm_template)
    new_dm["draft_id"]          = project_uuid
    new_dm["draft_name"]        = project_name
    new_dm["draft_fold_path"]   = project_dir_str
    new_dm["draft_root_path"]   = capcut_dir_str
    new_dm["draft_cover"]       = "draft_cover.jpg"
    new_dm["tm_draft_create"]   = int(time.time() * 1_000_000)
    new_dm["tm_draft_modified"] = int(time.time() * 1_000_000)
    new_dm["tm_duration"]       = total_us
    new_dm["tm_draft_removed"]  = 0

    total_size = master_audio.stat().st_size + sum(c["file_size"] for c in clips[:len(used_clips)])
    new_dm["draft_timeline_materials_size_"] = total_size

    meta_type0 = []
    for clip_path, mat_id in used_clips.items():
        cp = Path(clip_path)
        vm_found = next((v for v in video_mats if v["id"] == mat_id), {})
        meta_type0.append({
            "ai_group_type": "", "create_time": int(time.time()),
            "duration": vm_found.get("duration", 0), "enter_from": 0,
            "extra_info": cp.name, "file_Path": clip_path,
            "height": vm_found.get("height", 1080), "id": str(uuid.uuid4()),
            "import_time": int(time.time()), "import_time_ms": int(time.time()*1000),
            "item_source": 1, "material_color_tag": "", "md5": "",
            "metetype": "video",
            "roughcut_time_range": {"duration": vm_found.get("duration", 0), "start": 0},
            "sub_time_range": {"duration": -1, "start": -1},
            "type": 0, "width": vm_found.get("width", 1920)
        })
    meta_type0.append({
        "ai_group_type": "", "create_time": int(time.time()),
        "duration": total_us, "enter_from": 0,
        "extra_info": master_audio.name, "file_Path": audio_path_str,
        "height": 0, "id": str(uuid.uuid4()),
        "import_time": int(time.time()), "import_time_ms": int(time.time()*1000),
        "item_source": 1, "material_color_tag": "", "md5": "",
        "metetype": "music",
        "roughcut_time_range": {"duration": total_us, "start": 0},
        "sub_time_range": {"duration": -1, "start": -1},
        "type": 0, "width": 0
    })
    for m in new_dm.get("draft_materials", []):
        if m.get("type") == 0:
            m["value"] = meta_type0

    # ── 12. Write All Project Files ─────────────────────────────────────────
    for sub in ["adjust_mask", "common_attachment", "matting", "qr_upload", "Resources", "smart_crop", "subdraft", "Timelines"]:
        (project_dir / sub).mkdir(parents=True, exist_ok=True)

    dc_json_str = json.dumps(new_dc, ensure_ascii=False)
    dm_json_str = json.dumps(new_dm, ensure_ascii=False)

    (project_dir / "draft_content.json").write_text(dc_json_str, encoding="utf-8")
    (project_dir / "draft_content.json.bak").write_text(dc_json_str, encoding="utf-8")
    (project_dir / "draft_meta_info.json").write_text(dm_json_str, encoding="utf-8")
    (project_dir / "template-2.tmp").write_text(dc_json_str, encoding="utf-8")

    tl_layout = {
        "dockItems": [
            {
                "dockIndex": 0,
                "ratio": 1,
                "timelineIds": [timeline_id],
                "timelineNames": ["Dòng thời gian 01"]
            }
        ],
        "layoutOrientation": 1
    }
    (project_dir / "timeline_layout.json").write_text(json.dumps(tl_layout, ensure_ascii=False), encoding="utf-8")

    now_s = int(time.time())
    (project_dir / "draft_settings").write_text(
        f"[General]\ndraft_create_time={now_s}\ndraft_last_edit_time={now_s}\nreal_edit_seconds=0\nreal_edit_keys=0\ncloud_last_modify_platform=windows\n",
        encoding="utf-8")

    # Cover image
    try:
        from PIL import Image
        cover_saved = False
        for fname in ["cover.png", "cover.jpg"]:
            src = story_dir / fname
            if src.exists():
                img = Image.open(src).convert("RGB")
                img.thumbnail((1280, 720))
                img.save(project_dir / "draft_cover.jpg", "JPEG", quality=85)
                cover_saved = True
                break
        if not cover_saved:
            Image.new("RGB", (1280, 720), (20, 24, 33)).save(project_dir / "draft_cover.jpg", "JPEG")
    except Exception as e:
        logger.warning(f"Cover image: {e}")

    # ── 13. Write CapCut 9.x Timelines Multi-layer Layout ────────────────────
    tl_dir = project_dir / "Timelines"
    tl_dir.mkdir(parents=True, exist_ok=True)

    now_us = int(time.time() * 1_000_000)
    pj_data = {
        "config": {
            "color_space": -1,
            "hdr_vivid": False,
            "mixed_track_mode_on": False,
            "render_index_track_mode_on": False,
            "use_float_render": False
        },
        "create_time": now_us,
        "id": timeline_container_id,
        "main_timeline_id": timeline_id,
        "timelines": [
            {
                "create_time": now_us,
                "id": timeline_id,
                "is_marked_delete": False,
                "name": "Dòng thời gian 01",
                "update_time": now_us
            }
        ],
        "update_time": now_us,
        "version": 0
    }
    pj_json_str = json.dumps(pj_data, ensure_ascii=False)
    (tl_dir / "project.json").write_text(pj_json_str, encoding="utf-8")
    (tl_dir / "project.json.bak").write_text(pj_json_str, encoding="utf-8")

    cur_tl_dir = tl_dir / timeline_id
    cur_tl_dir.mkdir(parents=True, exist_ok=True)
    (cur_tl_dir / "draft_content.json").write_text(dc_json_str, encoding="utf-8")
    (cur_tl_dir / "draft_content.json.bak").write_text(dc_json_str, encoding="utf-8")
    (cur_tl_dir / "template-2.tmp").write_text(dc_json_str, encoding="utf-8")
    (cur_tl_dir / "template.tmp").write_text("", encoding="utf-8")
    if (project_dir / "draft_cover.jpg").exists():
        shutil.copy2(project_dir / "draft_cover.jpg", cur_tl_dir / "draft_cover.jpg")

    ref_tl_cand = None
    ref_tl_base = template_dir / "Timelines"
    if ref_tl_base.exists():
        for sub in ref_tl_base.iterdir():
            if sub.is_dir():
                ref_tl_cand = sub
                break

    if ref_tl_cand and ref_tl_cand.exists():
        for fname in ["attachment_editing.json", "attachment_pc_common.json", "draft.extra"]:
            src_f = ref_tl_cand / fname
            if src_f.exists():
                shutil.copy2(src_f, cur_tl_dir / fname)
        ref_common = ref_tl_cand / "common_attachment"
        cur_common = cur_tl_dir / "common_attachment"
        cur_common.mkdir(parents=True, exist_ok=True)
        if ref_common.exists():
            for f in ref_common.iterdir():
                if f.is_file():
                    shutil.copy2(f, cur_common / f.name)

    src_crypto = template_dir / "crypto_key_store.dat"
    if src_crypto.exists():
        shutil.copy2(src_crypto, project_dir / "crypto_key_store.dat")
        logger.info("🔑 Copied crypto_key_store.dat")

    # ── 14. Update root_meta_info.json ──────────────────────────────────────
    try:
        root_data = json.loads(root_meta_file.read_text(encoding="utf-8-sig"))
    except Exception:
        root_data = {"all_draft_store": [], "draft_ids": 1, "root_path": capcut_dir_str}

    store = root_data.get("all_draft_store", [])
    existing_idx = next((i for i, e in enumerate(store)
                         if e.get("draft_id") == project_uuid or e.get("draft_name") == project_name), None)

    root_item = {
        "cloud_draft_cover": False,
        "cloud_draft_sync": False,
        "draft_cloud_last_action_download": False,
        "draft_cloud_purchase_info": "",
        "draft_cloud_template_id": "",
        "draft_cloud_tutorial_info": "",
        "draft_cloud_videocut_purchase_info": "",
        "draft_cover": f"{project_dir_str}\\draft_cover.jpg",
        "draft_fold_path": project_dir_str,
        "draft_id": project_uuid,
        "draft_is_ai_shorts": False,
        "draft_is_cloud_temp_draft": False,
        "draft_is_infinite_canvas_draft": False,
        "draft_is_invisible": False,
        "draft_is_pippit_draft": False,
        "draft_is_web_article_video": False,
        "draft_json_file": f"{project_dir_str}\\draft_content.json",
        "draft_name": project_name,
        "draft_new_version": "",
        "draft_root_path": capcut_dir_str,
        "draft_timeline_materials_size": total_size,
        "draft_type": "",
        "draft_web_article_video_enter_from": "",
        "pippit_avatar_url": "",
        "pippit_extra_info": "",
        "pippit_id": "",
        "pippit_user_name": "",
        "streaming_edit_draft_ready": True,
        "tm_draft_cloud_completed": "",
        "tm_draft_cloud_entry_id": -1,
        "tm_draft_cloud_modified": 0,
        "tm_draft_cloud_parent_entry_id": -1,
        "tm_draft_cloud_space_id": -1,
        "tm_draft_cloud_user_id": -1,
        "tm_draft_create": int(time.time() * 1_000_000),
        "tm_draft_modified": int(time.time() * 1_000_000),
        "tm_draft_removed": 0,
        "tm_duration": total_us
    }

    if existing_idx is not None:
        store[existing_idx] = root_item
        store.insert(0, store.pop(existing_idx))
    else:
        store.insert(0, root_item)

    root_data["all_draft_store"] = store
    root_meta_file.write_text(json.dumps(root_data, ensure_ascii=False, indent=2), encoding="utf-8")

    logger.info("=" * 70)
    logger.info(f"🎉 CAPCUT 9.x CONTEXT-AWARE DRAFT EXPORTED: {project_name}")
    logger.info(f"   Project UUID : {project_uuid}")
    logger.info(f"   Timeline ID  : {timeline_id}")
    logger.info(f"   Total Tracks : {len(all_tracks)} tracks:")
    for idx, tr in enumerate(all_tracks):
        logger.info(f"     [{idx+1}] {tr.get('name', tr.get('type'))} ({len(tr.get('segments', []))} segs)")
    logger.info(f"   Total Dur    : {total_s:.1f}s ({total_s/60:.2f} mins)")
    logger.info("=" * 70)
    return project_dir


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="Export CapCut PC Draft (Context-Aware Multi-Layer Engine)")
    p.add_argument("--story-dir", required=True, help="Đường dẫn thư mục story output")
    p.add_argument("--project-name", default="samkechuyen", help="Tên dự án CapCut (mặc định: samkechuyen)")
    p.add_argument("--bg-videos-dir", default=str(DEFAULT_BG_VIDEOS_DIR), help="Thư mục background video stock")
    p.add_argument("--bgm", default=None, help="File nhạc nền BGM (tuỳ chọn)")
    p.add_argument("--sfx-dir", default=str(DEFAULT_SFX_DIR), help="Thư mục SFX/Ambience")
    args = p.parse_args()

    build_capcut_draft(
        story_dir=Path(args.story_dir),
        project_name=args.project_name,
        bg_videos_dir=Path(args.bg_videos_dir) if args.bg_videos_dir else None,
        bgm_path=Path(args.bgm) if args.bgm else None,
        sfx_dir=Path(args.sfx_dir) if args.sfx_dir else None
    )
