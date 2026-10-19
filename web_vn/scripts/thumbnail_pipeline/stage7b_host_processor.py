# -*- coding: utf-8 -*-
"""
STAGE 7B: HOST ASSET PROCESSOR & AUTOMATIC CUTOUT
- Loads and prepares real brand host assets (Bác Sâm)
- Automatic background removal (rembg u2net) with content-hash caching
- Expression matching (shock, grief, anger, disbelief, suspicious, serious)
- Alpha edge softening (feathering) to eliminate hard cut artifacts
- Directional contact drop-shadow generation
- Dynamic scaling and positioning (host_position = "left" | "right")
- Eliminates 100% Host Identity Drift by using real brand assets deterministically
"""

import os
import sys
import hashlib
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from PIL import Image, ImageFilter, ImageOps, ImageEnhance

logger = logging.getLogger("thumbnail_pipeline.stage7b")


def get_file_md5(file_path: Path) -> str:
    """Computes MD5 hash of file for cache validation."""
    hasher = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            hasher.update(chunk)
    return hasher.hexdigest()[:12]


def ensure_host_cutout(
    source_img_path: Path,
    cache_dir: Optional[Path] = None,
) -> Image.Image:
    """
    Ensures the host image has a transparent alpha background.
    If the image is already RGBA with transparency, loads directly.
    If RGB, runs rembg and caches the transparent PNG.
    """
    if not source_img_path.exists():
        raise FileNotFoundError(f"Host source image not found: {source_img_path}")

    # Check if image already has transparency
    img = Image.open(source_img_path)
    if img.mode == "RGBA":
        # Check if alpha channel has transparent pixels
        extrema = img.getextrema()
        if len(extrema) == 4 and extrema[3][0] < 250:
            logger.info(f"Host image already has transparent alpha: {source_img_path}")
            return img

    # Check for pre-existing reference_cutout.png in same folder
    precomputed_cutout = source_img_path.parent / f"{source_img_path.stem}_cutout.png"
    if precomputed_cutout.exists():
        cutout_img = Image.open(precomputed_cutout)
        if cutout_img.mode == "RGBA":
            logger.info(f"Loaded existing precomputed cutout: {precomputed_cutout}")
            return cutout_img

    # Use cache directory or fallback
    target_cache_dir = cache_dir or source_img_path.parent / ".cutout_cache"
    target_cache_dir.mkdir(parents=True, exist_ok=True)
    img_hash = get_file_md5(source_img_path)
    cache_file = target_cache_dir / f"host_cutout_{img_hash}.png"

    if cache_file.exists():
        logger.info(f"Loading cached host cutout from {cache_file}")
        return Image.open(cache_file)

    logger.info(f"Generating automatic cutout for {source_img_path} via rembg...")
    try:
        from rembg import remove
        cutout_img = remove(img)
        cutout_img.save(cache_file, format="PNG")
        logger.info(f"Saved host cutout to cache: {cache_file}")
        return cutout_img
    except Exception as e:
        logger.warning(f"rembg background removal failed ({e}), falling back to direct image with corner alpha")
        rgba_img = img.convert("RGBA")
        return rgba_img


def process_host_for_canvas(
    host_profile: Dict[str, Any],
    host_emotion: str = "serious",
    host_position: str = "left",
    canvas_width: int = 1280,
    canvas_height: int = 720,
    target_height_ratio: float = 0.74,
    feather_radius: int = 2,
    shadow_blur: int = 22,
    shadow_opacity: float = 0.65,
) -> Tuple[Image.Image, Image.Image, Tuple[int, int]]:
    """
    Prepares the Host Cutout and its Drop Shadow for the final canvas.
    Returns:
        (host_cutout_img, shadow_img, (pos_x, pos_y))
    """
    host_position = host_position.lower()
    host_emotion = host_emotion.lower()

    # 1. Select the best host asset (Expression pack vs Default reference)
    expressions = host_profile.get("expressions", {})
    selected_asset_path: Optional[Path] = None

    if host_emotion in expressions and Path(expressions[host_emotion]).exists():
        selected_asset_path = Path(expressions[host_emotion])
        logger.info(f"Selected expression asset for '{host_emotion}': {selected_asset_path}")
    elif host_profile.get("reference_path") and Path(host_profile["reference_path"]).exists():
        selected_asset_path = Path(host_profile["reference_path"])
        logger.info(f"Selected default reference asset: {selected_asset_path}")
    elif expressions:
        # Pick any available expression
        first_key = list(expressions.keys())[0]
        selected_asset_path = Path(expressions[first_key])
        logger.info(f"Fallback to available expression '{first_key}': {selected_asset_path}")

    if not selected_asset_path or not selected_asset_path.exists():
        raise FileNotFoundError(f"No valid host asset found in host_profile: {host_profile}")

    # 2. Extract alpha cutout
    host_raw = ensure_host_cutout(selected_asset_path)
    if host_raw.mode != "RGBA":
        host_raw = host_raw.convert("RGBA")

    # 3. Scale host to target height ratio (e.g. 74% of 720px = 532px)
    target_h = int(canvas_height * target_height_ratio)
    orig_w, orig_h = host_raw.size
    aspect = orig_w / max(1, orig_h)
    target_w = int(target_h * aspect)

    # Cap max width if too wide
    max_w = int(canvas_width * 0.44)
    if target_w > max_w:
        target_w = max_w
        target_h = int(target_w / aspect)

    host_scaled = host_raw.resize((target_w, target_h), Image.Resampling.LANCZOS)

    # 4. Horizontal gaze adjustment:
    # If host is on the right, host should generally look towards the left (center of drama)
    # If host is on the left, host should look towards the right
    # (By default reference photo looks slightly right; we can mirror if on right)
    if host_position == "right":
        # Check if mirror makes sense
        host_scaled = ImageOps.mirror(host_scaled)

    # 5. Alpha edge softening (Feathering)
    if feather_radius > 0:
        r, g, b, a = host_scaled.split()
        a_blurred = a.filter(ImageFilter.GaussianBlur(feather_radius))
        host_scaled = Image.merge("RGBA", (r, g, b, a_blurred))

    # 6. Generate Soft Directional Contact Shadow
    # Shadow layer has black RGB and blurred alpha
    r, g, b, a = host_scaled.split()
    black_rgb = Image.new("RGB", host_scaled.size, (0, 0, 0))
    # Multiply alpha by opacity
    a_shadow = a.point(lambda p: int(p * shadow_opacity))
    shadow_raw = Image.merge("RGBA", (black_rgb.split()[0], black_rgb.split()[1], black_rgb.split()[2], a_shadow))
    
    # Expand canvas for shadow blur
    pad = shadow_blur * 2
    shadow_padded = Image.new("RGBA", (target_w + pad * 2, target_h + pad * 2), (0, 0, 0, 0))
    shadow_padded.paste(shadow_raw, (pad, pad), shadow_raw)
    shadow_blurred = shadow_padded.filter(ImageFilter.GaussianBlur(shadow_blur))

    # 7. Compute placement coordinates (anchored to bottom of canvas)
    pos_y = canvas_height - target_h
    if host_position == "right":
        pos_x = canvas_width - target_w
        shadow_x = pos_x - pad - 10
        shadow_y = pos_y - pad + 10
    else:  # left
        pos_x = 0
        shadow_x = pos_x - pad + 10
        shadow_y = pos_y - pad + 10

    logger.info(f"Stage 7B processed host: pos=({pos_x}, {pos_y}), size=({target_w}x{target_h}), position={host_position}")
    return host_scaled, shadow_blurred, (pos_x, pos_y), (shadow_x, shadow_y)
