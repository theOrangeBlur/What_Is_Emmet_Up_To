#!/usr/bin/env python3
"""
Media Processing Script for Visual Stitch
Scans monthly media folders, processes images and videos, and stitches them into one compilation.
"""

import os
import re
import subprocess
import json
from pathlib import Path
from typing import List, Tuple

# Configuration
SCRIPT_DIR = Path(__file__).parent
MEDIA_DIR = SCRIPT_DIR / "media"
OUTPUT_DIR = SCRIPT_DIR / "output"
TEMP_DIR = SCRIPT_DIR / "temp_processed"
OUTPUT_VIDEO = OUTPUT_DIR / "compilation.mp4"
DEFAULT_IMAGE_DURATION = 3  # seconds

# Supported formats
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png'}
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv'}

def parse_duration_from_filename(filename: str) -> int:
    """
    Extract duration from filename with _Xs suffix (e.g., sunset_5s.jpg -> 5)
    Returns None if no duration suffix found.
    """
    match = re.search(r'_(\d+)s\.(?:jpg|jpeg|png)$', filename, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None

def get_video_duration(video_path: Path) -> float:
    """Use ffprobe to get video duration in seconds."""
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
             '-of', 'json', str(video_path)],
            capture_output=True,
            text=True,
            check=True
        )
        data = json.loads(result.stdout)
        return float(data['format']['duration'])
    except Exception as e:
        print(f"Warning: Could not get duration for {video_path}: {e}")
        return 5.0  # Default fallback

def get_media_files() -> List[Tuple[Path, float, str]]:
    """
    Scan media folders and return list of (path, duration, sort_key) tuples.
    Sort key is folder_name/filename for chronological sorting.
    """
    media_files = []

    # Scan all subdirectories in media folder
    for month_dir in sorted(MEDIA_DIR.iterdir()):
        if not month_dir.is_dir():
            continue

        for media_file in sorted(month_dir.iterdir()):
            if not media_file.is_file():
                continue

            ext = media_file.suffix.lower()
            sort_key = f"{month_dir.name}/{media_file.name}"

            if ext in IMAGE_EXTENSIONS:
                # Parse duration from filename, or use default
                duration = parse_duration_from_filename(media_file.name)
                if duration is None:
                    duration = DEFAULT_IMAGE_DURATION
                media_files.append((media_file, float(duration), sort_key))

            elif ext in VIDEO_EXTENSIONS:
                duration = get_video_duration(media_file)
                media_files.append((media_file, duration, sort_key))

    # Sort by sort_key (chronological: folder then filename)
    media_files.sort(key=lambda x: x[2])
    return media_files

def process_image_to_video(image_path: Path, duration: float, output_path: Path):
    """Convert image to video clip using FFmpeg."""
    print(f"  Processing image: {image_path.name} ({duration}s)")
    subprocess.run([
        'ffmpeg', '-y',
        '-loop', '1',
        '-i', str(image_path),
        '-c:v', 'libx264',
        '-t', str(duration),
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
        str(output_path)
    ], check=True, capture_output=True)

def standardize_video(video_path: Path, output_path: Path):
    """Re-encode video to ensure compatibility and consistent format."""
    print(f"  Processing video: {video_path.name}")
    subprocess.run([
        'ffmpeg', '-y',
        '-i', str(video_path),
        '-c:v', 'libx264',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
        '-c:a', 'aac',
        '-b:a', '128k',
        str(output_path)
    ], check=True, capture_output=True)

def concatenate_videos(video_paths: List[Path], output_path: Path):
    """Concatenate all video clips into final compilation."""
    print(f"\nConcatenating {len(video_paths)} clips...")

    # Create concat file
    concat_file = TEMP_DIR / "concat_list.txt"
    with open(concat_file, 'w') as f:
        for video_path in video_paths:
            # FFmpeg concat requires forward slashes even on Windows
            path_str = str(video_path).replace('\\', '/')
            f.write(f"file '{path_str}'\n")

    # Concatenate
    subprocess.run([
        'ffmpeg', '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', str(concat_file),
        '-c', 'copy',
        str(output_path)
    ], check=True, capture_output=True)

def main():
    """Main processing logic."""
    print("=" * 60)
    print("Visual Stitch Media Processor")
    print("=" * 60)

    # Ensure directories exist
    OUTPUT_DIR.mkdir(exist_ok=True)
    TEMP_DIR.mkdir(exist_ok=True)

    # Get all media files
    print(f"\nScanning media folder: {MEDIA_DIR}")
    media_files = get_media_files()

    if not media_files:
        print("No media files found!")
        return

    print(f"Found {len(media_files)} media files")

    # Process each media file
    print("\nProcessing media files...")
    processed_clips = []

    for idx, (media_path, duration, sort_key) in enumerate(media_files):
        ext = media_path.suffix.lower()
        output_clip = TEMP_DIR / f"clip_{idx:04d}.mp4"

        try:
            if ext in IMAGE_EXTENSIONS:
                process_image_to_video(media_path, duration, output_clip)
            elif ext in VIDEO_EXTENSIONS:
                standardize_video(media_path, output_clip)

            processed_clips.append(output_clip)

        except subprocess.CalledProcessError as e:
            print(f"  ERROR processing {media_path.name}: {e}")
            continue

    if not processed_clips:
        print("\nNo clips were successfully processed!")
        return

    # Concatenate all clips
    concatenate_videos(processed_clips, OUTPUT_VIDEO)

    print(f"\n{'=' * 60}")
    print(f"SUCCESS! Compilation video created:")
    print(f"  {OUTPUT_VIDEO}")
    print(f"  Total clips: {len(processed_clips)}")
    print(f"{'=' * 60}")

if __name__ == "__main__":
    main()
