"""
CapCut Draft Generator / Patcher (CapCut 9.x Architecture):
- Supports full multi-timeline architecture with Timelines/<timeline_id>/
- Keeps root_meta_info.json and draft_meta_info.json synchronized
- Emits identical draft_content.json to root and Timelines/<timeline_id>/
- Recreates all necessary attachment and configuration files from standard template
"""
import json, os, sys, uuid, time, hashlib, shutil, random, logging, copy
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("capcut_engine")

BASE = Path(os.environ["LOCALAPPDATA"]) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft"

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

def scan_videos(videos_dir: Path, seed=42):
    import cv2
    exts = {".mp4", ".mov", ".mkv", ".webm"}
    files = [p for p in videos_dir.iterdir() if p.suffix.lower() in exts and p.is_file()]
    clips = []
    logger.info(f"Probing {len(files)} clips...")
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
    logger.info(f"✅ {len(clips)} valid clips, total pool: {sum(c['duration_us'] for c in clips)/1e6/60:.1f} mins")
    return clips

def export_capcut_project(story_dir: Path, project_name: str, bg_videos_dir: Path):
    project_dir = BASE / project_name
    project_dir.mkdir(parents=True, exist_ok=True)

    # ── 1. Find best working reference project as template ────────────────────
    template_dir = None
    for cand in ["Airframe Evidence", "0.9", "Korean", "highwithme", "MATAN"]:
        p = BASE / cand
        if p.exists() and (p / "draft_content.json").exists() and (p / "Timelines" / "project.json").exists():
            template_dir = p
            break

    if not template_dir:
        # Fallback to any directory with draft_content.json
        for cand in ["Airframe Evidence", "0.9"]:
            if (BASE / cand / "draft_content.json").exists():
                template_dir = BASE / cand
                break

    if not template_dir:
        raise FileNotFoundError("No reference CapCut project found in com.lveditor.draft")

    logger.info(f"📋 Using template from: {template_dir.name}")

    with open(template_dir / "draft_content.json", encoding="utf-8") as f:
        dc_template = json.load(f)
    with open(template_dir / "draft_meta_info.json", encoding="utf-8") as f:
        dm_template = json.load(f)

    # ── 2. Determine UUIDs ───────────────────────────────────────────────────
    root_meta_file = BASE / "root_meta_info.json"
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

    # ── 3. Probe Audio & Videos ──────────────────────────────────────────────
    master_audio = story_dir / "full_story_audio.mp3"
    total_us = probe_audio_duration_us(master_audio)
    total_s = total_us / 1_000_000
    logger.info(f"🎵 Audio: {master_audio.name} ({total_s:.1f}s / {total_s/60:.2f} mins)")

    clips = scan_videos(bg_videos_dir)

    # ── 4. Extract schema prototypes from template ───────────────────────────
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

    # ── 5. Build Video Segments & Track ──────────────────────────────────────
    speeds_l, plcs_l, canvases_l = [], [], []
    anims_l, snds_l, matcols_l, vocals_l, beats_l = [], [], [], [], []
    video_mats, used_clips = [], {}
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

    logger.info(f"🎬 {len(video_segs)} video segments, {len(used_clips)} unique clips")

    # ── 6. Build Master Audio Segment & Track ────────────────────────────────
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

    vtrack = copy.deepcopy(real_vtrack)
    vtrack["id"] = str(uuid.uuid4()).upper()
    vtrack["attribute"] = 4
    vtrack["segments"] = video_segs

    atrack = copy.deepcopy(real_atrack)
    atrack["id"] = str(uuid.uuid4()).upper()
    atrack["attribute"] = 4
    atrack["segments"] = [aseg]

    # ── 7. Build Full Materials & Draft Content ──────────────────────────────
    mats = copy.deepcopy(dc_template["materials"])
    for k in mats:
        mats[k] = []
    mats["videos"]                = video_mats
    mats["audios"]                = [am]
    mats["speeds"]                = speeds_l
    mats["placeholder_infos"]     = plcs_l
    mats["canvases"]              = canvases_l
    mats["material_animations"]   = anims_l
    mats["sound_channel_mappings"]= snds_l
    mats["material_colors"]       = matcols_l
    mats["vocal_separations"]     = vocals_l
    mats["beats"]                 = beats_l

    new_dc = copy.deepcopy(dc_template)
    new_dc["id"]           = timeline_id  # In CapCut 9.x, draft_content ID is the timeline ID
    new_dc["name"]         = ""
    new_dc["duration"]     = total_us
    new_dc["create_time"]  = int(time.time())
    new_dc["update_time"]  = int(time.time())
    new_dc["tracks"]       = [vtrack, atrack]
    new_dc["materials"]    = mats
    new_dc["keyframes"]    = {k: [] for k in new_dc.get("keyframes", {})}
    new_dc["keyframe_graph_list"] = []
    new_dc["group_container"] = {"groups": []}
    new_dc["extra_info"]   = {"text_to_video": None, "track_info": None, "subtitle_fragment_info_list": []}

    # ── 8. Build draft_meta_info ─────────────────────────────────────────────
    project_dir_str = str(project_dir).replace("\\", "/")
    capcut_dir_str  = str(BASE).replace("\\", "/")

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

    # ── 9. Setup Directory Structure & Subfolders ────────────────────────────
    for sub in ["adjust_mask", "common_attachment", "matting", "qr_upload", "Resources", "smart_crop", "subdraft", "Timelines"]:
        (project_dir / sub).mkdir(parents=True, exist_ok=True)

    # ── 10. Write Root Project Files ─────────────────────────────────────────
    dc_json_str = json.dumps(new_dc, ensure_ascii=False)
    dm_json_str = json.dumps(new_dm, ensure_ascii=False)

    (project_dir / "draft_content.json").write_text(dc_json_str, encoding="utf-8")
    (project_dir / "draft_content.json.bak").write_text(dc_json_str, encoding="utf-8")
    (project_dir / "draft_meta_info.json").write_text(dm_json_str, encoding="utf-8")
    (project_dir / "template-2.tmp").write_text(dc_json_str, encoding="utf-8")

    # timeline_layout.json
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

    # draft_settings
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
        logger.warning(f"Cover generation: {e}")

    # ── 11. Write CapCut 9.x Timelines Architecture ─────────────────────────
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

    # Specific timeline subdirectory
    cur_tl_dir = tl_dir / timeline_id
    cur_tl_dir.mkdir(parents=True, exist_ok=True)
    (cur_tl_dir / "draft_content.json").write_text(dc_json_str, encoding="utf-8")
    (cur_tl_dir / "draft_content.json.bak").write_text(dc_json_str, encoding="utf-8")
    (cur_tl_dir / "template-2.tmp").write_text(dc_json_str, encoding="utf-8")
    (cur_tl_dir / "template.tmp").write_text("", encoding="utf-8")
    if (project_dir / "draft_cover.jpg").exists():
        shutil.copy2(project_dir / "draft_cover.jpg", cur_tl_dir / "draft_cover.jpg")

    # Copy attachments / extras if template has them
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

    # ── 12. Copy crypto_key_store.dat from template if exists ───────────────
    src_crypto = template_dir / "crypto_key_store.dat"
    if src_crypto.exists():
        shutil.copy2(src_crypto, project_dir / "crypto_key_store.dat")
        logger.info("🔑 Copied crypto_key_store.dat")

    # ── 13. Update root_meta_info.json ──────────────────────────────────────
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

    logger.info("=" * 60)
    logger.info(f"✅ CAPCUT 9.x DRAFT FULLY SYNCHRONIZED: {project_name}")
    logger.info(f"   Project UUID : {project_uuid}")
    logger.info(f"   Timeline ID  : {timeline_id}")
    logger.info(f"   Duration     : {total_s:.1f}s ({total_s/60:.2f} mins)")
    logger.info(f"   Segments     : {len(video_segs)} video segs ({len(used_clips)} unique clips)")
    logger.info(f"   Audio Track  : {master_audio.name}")
    logger.info("=" * 60)
    return project_dir


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--story-dir", required=True, help="Path to story output dir (contains full_story_audio.mp3)")
    p.add_argument("--project-name", default="samkechuyen", help="CapCut project name")
    p.add_argument("--bg-videos-dir", default=str(Path("web_vn/data/background_videos/traffic_night").resolve()))
    args = p.parse_args()

    story_dir = Path(args.story_dir).resolve()
    bg_dir = Path(args.bg_videos_dir).resolve()

    export_capcut_project(story_dir, args.project_name, bg_dir)
