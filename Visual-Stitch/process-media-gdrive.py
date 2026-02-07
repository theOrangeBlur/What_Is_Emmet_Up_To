#!/usr/bin/env python3
"""
Media Processing Script for Visual Stitch with Google Drive API
Fetches media from a Google Drive folder, processes images and videos,
and stitches them into one compilation video.

Migration from Google Photos API (deprecated March 2025) to Google Drive API.
"""

import os
import re
import sys
import json
import subprocess
import argparse
from pathlib import Path
from typing import List, Tuple, Optional
from datetime import datetime
import ssl
import time
import tempfile
import io
import shutil

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseDownload
from google.cloud import storage

# Configuration
SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR / "output"
TEMP_DIR = SCRIPT_DIR / "temp_processed"
TEMP_DOWNLOAD_DIR = SCRIPT_DIR / "temp_downloads"
OUTPUT_VIDEO = OUTPUT_DIR / "compilation.mp4"
DEFAULT_IMAGE_DURATION = 2  # seconds
CROSSFADE_DURATION = 0.5  # seconds for crossfade transitions between clips

# FFmpeg path - check common Windows install location, fall back to PATH
FFMPEG_WINDOWS_PATH = Path(r"C:\Users\eckma\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe")
FFPROBE_WINDOWS_PATH = Path(r"C:\Users\eckma\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffprobe.exe")

def get_ffmpeg():
    """Return ffmpeg path - use Windows install if available, otherwise rely on PATH."""
    if FFMPEG_WINDOWS_PATH.exists():
        return str(FFMPEG_WINDOWS_PATH)
    return 'ffmpeg'

def get_ffprobe():
    """Return ffprobe path - use Windows install if available, otherwise rely on PATH."""
    if FFPROBE_WINDOWS_PATH.exists():
        return str(FFPROBE_WINDOWS_PATH)
    return 'ffprobe'

# Google Drive API scopes (full access needed for delete after processing)
SCOPES = ['https://www.googleapis.com/auth/drive']

# Supported formats
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.m4v', '.3gp'}
ALL_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS

def get_credentials() -> Credentials:
    """
    Get Google Drive API credentials using OAuth 2.0.
    Looks for token.json for existing auth, or client_secret.json for new auth.
    """
    creds = None
    token_path = SCRIPT_DIR / 'token.json'
    client_secret_path = SCRIPT_DIR / 'client_secret.json'

    # Check for token in environment variable (for GitHub Actions)
    token_json = os.environ.get('GOOGLE_DRIVE_TOKEN')
    if token_json:
        try:
            token_data = json.loads(token_json)
            creds = Credentials.from_authorized_user_info(token_data, SCOPES)
        except Exception as e:
            print(f"Warning: Could not load token from environment: {e}")

    # Load from file if available
    if not creds and token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)

    # Refresh if expired
    if creds and creds.expired and creds.refresh_token:
        print("Refreshing expired credentials...")
        creds.refresh(Request())
        # Save refreshed token
        with open(token_path, 'w') as token:
            token.write(creds.to_json())

    # Get new credentials if needed
    if not creds or not creds.valid:
        if not client_secret_path.exists():
            # Check environment variable
            client_secret_json = os.environ.get('GOOGLE_DRIVE_CLIENT_SECRET')
            if client_secret_json:
                with open(client_secret_path, 'w') as f:
                    f.write(client_secret_json)
            else:
                raise FileNotFoundError(
                    f"No credentials found. Please download client_secret.json from "
                    f"Google Cloud Console and place it in {SCRIPT_DIR}"
                )

        flow = InstalledAppFlow.from_client_secrets_file(
            str(client_secret_path), SCOPES)
        creds = flow.run_local_server(port=0)

        # Save credentials for future use
        with open(token_path, 'w') as token:
            token.write(creds.to_json())

        print(f"\n[OK] Authentication successful! Token saved to {token_path}")
        print(f"Add this token to GitHub Secrets as GOOGLE_DRIVE_TOKEN:\n")
        print(creds.to_json())

    return creds


def list_folders(service) -> List[dict]:
    """List all folders in the user's Google Drive."""
    try:
        results = service.files().list(
            q="mimeType='application/vnd.google-apps.folder' and trashed=false",
            pageSize=50,
            fields="files(id, name, modifiedTime)"
        ).execute()
        folders = results.get('files', [])

        if not folders:
            print("No folders found.")
            return []

        print("\n" + "=" * 60)
        print("Your Google Drive Folders:")
        print("=" * 60)
        for folder in folders:
            name = folder.get('name', 'Untitled')
            folder_id = folder['id']
            modified = folder.get('modifiedTime', 'Unknown')
            print(f"\nFolder: {name}")
            print(f"  ID: {folder_id}")
            print(f"  Modified: {modified}")
        print("=" * 60)

        return folders

    except HttpError as error:
        print(f"An error occurred: {error}")
        return []


def get_month_subfolders(service, parent_folder_id: str) -> List[dict]:
    """
    Get all YYYY-MM formatted subfolders within a parent folder.
    Returns list of folder dicts sorted by name (chronological).
    """
    try:
        query = f"'{parent_folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
        results = service.files().list(
            q=query,
            pageSize=100,
            fields="files(id, name)"
        ).execute()
        folders = results.get('files', [])

        # Filter to only YYYY-MM formatted folders
        month_pattern = re.compile(r'^\d{4}-\d{2}$')
        month_folders = [f for f in folders if month_pattern.match(f.get('name', ''))]

        # Sort by name (chronological due to ISO format)
        month_folders.sort(key=lambda x: x.get('name', ''))

        return month_folders

    except HttpError as error:
        print(f"An error occurred listing subfolders: {error}")
        return []


def filter_folders_by_range(folders: List[dict], start_month: str = None, end_month: str = None) -> List[dict]:
    """
    Filter folders to those within the specified month range.
    start_month/end_month format: YYYY-MM (inclusive on both ends).
    """
    if not start_month and not end_month:
        return folders

    filtered = []
    for folder in folders:
        name = folder.get('name', '')
        # String comparison works for YYYY-MM format
        if start_month and name < start_month:
            continue
        if end_month and name > end_month:
            continue
        filtered.append(folder)

    return filtered


def parse_duration_from_filename(filename: str) -> Optional[int]:
    """
    Extract duration from filename with _Xs suffix (e.g., sunset_5s.jpg -> 5)
    Returns None if no duration suffix found.
    """
    match = re.search(r'_(\d+)s\.', filename, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None


def parse_datetime_from_filename(filename: str) -> Optional[datetime]:
    """
    Extract datetime from filename patterns like PXL_20251006_202543692.mp4
    Returns None if no date pattern found.
    """
    # Pattern: YYYYMMDD_HHMMSS (with optional milliseconds)
    match = re.search(r'(\d{8})_(\d{6})', filename)
    if match:
        try:
            date_str = match.group(1) + match.group(2)
            return datetime.strptime(date_str, '%Y%m%d%H%M%S')
        except ValueError:
            pass
    return None


def get_month_from_datetime(dt: datetime) -> str:
    """Extract YYYY-MM month string from datetime."""
    return dt.strftime('%Y-%m')


def should_skip_file(filename: str) -> bool:
    """Check if filename indicates it should be skipped (starts with _SKIP_)."""
    return filename.startswith('_SKIP_')


def get_media_from_folder(service, folder_id: str, limit: int = None, _retries: int = 3) -> List[dict]:
    """
    Fetch all media files from a specific Google Drive folder.
    Returns list of file dictionaries, optionally limited to first N items.
    Retries on transient SSL/connection errors.
    """
    print(f"\nFetching media from folder: {folder_id}")

    # Build query for supported media types
    mime_queries = [
        "mimeType contains 'image/'",
        "mimeType contains 'video/'"
    ]
    mime_query = " or ".join(mime_queries)
    query = f"'{folder_id}' in parents and ({mime_query}) and trashed=false"

    for attempt in range(_retries):
        try:
            media_items = []
            page_token = None

            while True:
                results = service.files().list(
                    q=query,
                    pageSize=100,
                    fields="nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, imageMediaMetadata/time, videoMediaMetadata)",
                    pageToken=page_token
                ).execute()

                items = results.get('files', [])
                media_items.extend(items)

                page_token = results.get('nextPageToken')
                if not page_token:
                    break

            # Sort by filename for chronological order (PXL_YYYYMMDD_HHMMSS pattern)
            media_items.sort(key=lambda x: x.get('name', ''))

            if limit and len(media_items) > limit:
                print(f"[TEST MODE] Limiting to {limit} of {len(media_items)} files")
                media_items = media_items[:limit]

            print(f"Found {len(media_items)} media items in folder")
            return media_items

        except (ssl.SSLError, ConnectionError, OSError) as error:
            if attempt < _retries - 1:
                wait = 5 * (attempt + 1)
                print(f"  Connection error (attempt {attempt + 1}/{_retries}): {error}")
                print(f"  Retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"  Failed after {_retries} attempts: {error}")
                return []
        except HttpError as error:
            print(f"An API error occurred: {error}")
            return []


def download_drive_file(service, file_id: str, filename: str, output_path: Path, _retries: int = 3) -> bool:
    """
    Download a file from Google Drive with retry on transient errors.
    Returns True if successful, False otherwise.
    """
    for attempt in range(_retries):
        try:
            request = service.files().get_media(fileId=file_id)

            with open(output_path, 'wb') as f:
                downloader = MediaIoBaseDownload(f, request)
                done = False
                while not done:
                    status, done = downloader.next_chunk()

            return True

        except (ssl.SSLError, ConnectionError, OSError) as e:
            if attempt < _retries - 1:
                wait = 5 * (attempt + 1)
                print(f"  Connection error downloading {filename} (attempt {attempt + 1}/{_retries}): {e}")
                print(f"  Retrying in {wait}s...")
                time.sleep(wait)
            else:
                print(f"  Failed to download {filename} after {_retries} attempts: {e}")
                return False
        except Exception as e:
            print(f"  Error downloading {filename}: {e}")
            return False


def delete_drive_file(service, file_id: str, filename: str) -> bool:
    """
    Delete a file from Google Drive (move to trash).
    Returns True if successful, False otherwise.
    """
    try:
        service.files().delete(fileId=file_id).execute()
        print(f"  Deleted from Drive: {filename}")
        return True
    except Exception as e:
        print(f"  Error deleting {filename}: {e}")
        return False


def get_file_extension(mime_type: str, filename: str) -> str:
    """Get file extension from mime type or filename."""
    # First try to get from filename
    ext = Path(filename).suffix.lower()
    if ext:
        return ext

    # Fall back to mime type mapping
    mime_to_ext = {
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/bmp': '.bmp',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'video/quicktime': '.mov',
        'video/x-msvideo': '.avi',
        'video/x-matroska': '.mkv',
        'video/x-m4v': '.m4v',
        'video/3gpp': '.3gp',
    }
    return mime_to_ext.get(mime_type, '.dat')


def get_video_duration(video_path: Path) -> float:
    """Use ffprobe to get video duration in seconds."""
    try:
        result = subprocess.run(
            [get_ffprobe(), '-v', 'error', '-show_entries', 'format=duration',
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


def has_audio_track(video_path: Path) -> bool:
    """Check if video file has an audio track using ffprobe."""
    try:
        result = subprocess.run(
            [get_ffprobe(), '-v', 'error', '-select_streams', 'a',
             '-show_entries', 'stream=codec_type', '-of', 'json', str(video_path)],
            capture_output=True, text=True, check=True
        )
        data = json.loads(result.stdout)
        return len(data.get('streams', [])) > 0
    except Exception:
        return False


def process_folder_media(service, folder_id: str, limit: int = None) -> List[Tuple[Path, float, datetime, str, str]]:
    """
    Download and catalog media from Google Drive folder.
    Returns list of (path, duration, date, file_id, filename) tuples sorted chronologically.
    """
    # Get media items from folder
    media_items = get_media_from_folder(service, folder_id, limit=limit)

    if not media_items:
        print("No media items found in folder!")
        return []

    # Ensure temp download directory exists
    TEMP_DOWNLOAD_DIR.mkdir(exist_ok=True)

    processed_media = []

    for idx, item in enumerate(media_items):
        filename = item.get('name', f'item_{idx}')
        mime_type = item.get('mimeType', '')
        file_id = item['id']

        # Check if file should be skipped
        if should_skip_file(filename):
            print(f"Skipping (excluded): {filename}")
            continue

        # Get file extension
        ext = get_file_extension(mime_type, filename)

        # Check if it's a supported format
        if ext not in IMAGE_EXTENSIONS and ext not in VIDEO_EXTENSIONS:
            print(f"Skipping (unsupported format): {filename}")
            continue

        # Create local path preserving original filename
        local_path = TEMP_DOWNLOAD_DIR / filename

        # Check if file already exists locally (incremental download)
        if local_path.exists():
            print(f"Using cached: {filename}")
        else:
            # Download the file
            print(f"Downloading: {filename}")
            if not download_drive_file(service, file_id, filename, local_path):
                continue

        # Get creation time - prefer filename, then EXIF via Drive API, then Drive upload time
        creation_time = parse_datetime_from_filename(filename)
        if not creation_time:
            # Try EXIF capture time from Drive's imageMediaMetadata
            exif_time = (item.get('imageMediaMetadata') or {}).get('time')
            if exif_time:
                try:
                    creation_time = datetime.strptime(exif_time, '%Y:%m:%d %H:%M:%S')
                except ValueError:
                    pass
        if not creation_time:
            # Fall back to Drive metadata (upload time, not capture time)
            creation_time_str = item.get('createdTime') or item.get('modifiedTime')
            if creation_time_str:
                creation_time = datetime.fromisoformat(creation_time_str.replace('Z', '+00:00')).replace(tzinfo=None)
            else:
                creation_time = datetime.now()

        # Determine duration
        if ext in IMAGE_EXTENSIONS:
            # Check for duration in filename
            duration = parse_duration_from_filename(filename)
            if duration is None:
                duration = DEFAULT_IMAGE_DURATION
            processed_media.append((local_path, float(duration), creation_time, file_id, filename))

        elif ext in VIDEO_EXTENSIONS:
            duration = get_video_duration(local_path)
            processed_media.append((local_path, duration, creation_time, file_id, filename))

    # Sort by creation time (chronological)
    processed_media.sort(key=lambda x: x[2])

    return processed_media


def format_date_for_overlay(dt: datetime) -> str:
    """Format datetime for video overlay (e.g., 'Oct 15, 2025')."""
    return dt.strftime('%b %d, %Y')


def process_image_to_video(image_path: Path, duration: float, output_path: Path, creation_time: datetime = None):
    """Convert image to video clip with silent audio track using FFmpeg."""
    print(f"  Processing image: {image_path.name} ({duration}s)")

    # Build video filter chain
    vf_parts = ['scale=1920:1080:force_original_aspect_ratio=decrease', 'pad=1920:1080:(ow-iw)/2:(oh-ih)/2']

    # Add date overlay if creation_time provided
    if creation_time:
        date_text = format_date_for_overlay(creation_time)
        # Escape special characters for FFmpeg drawtext
        date_text = date_text.replace("'", "\\'").replace(":", "\\:")
        vf_parts.append(
            f"drawtext=text='{date_text}':fontsize=48:fontcolor=0x87CEEB:x=40:y=40:"
            f"shadowcolor=black:shadowx=2:shadowy=2"
        )

    vf_filter = ','.join(vf_parts)

    # Generate video from image with silent audio track for consistent concatenation
    subprocess.run([
        get_ffmpeg(), '-y',
        '-loop', '1',
        '-i', str(image_path),
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-c:v', 'libx264',
        '-t', str(duration),
        '-r', '30',  # Force 30fps for consistent timebase with xfade
        '-pix_fmt', 'yuv420p',
        '-vf', vf_filter,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',  # Stop when video ends
        str(output_path)
    ], check=True, capture_output=True)


def standardize_video(video_path: Path, output_path: Path, creation_time: datetime = None):
    """Re-encode video to ensure compatibility and consistent format with optional date overlay."""
    print(f"  Processing video: {video_path.name}")

    # Build video filter chain
    vf_parts = ['scale=1920:1080:force_original_aspect_ratio=decrease', 'pad=1920:1080:(ow-iw)/2:(oh-ih)/2']

    # Add date overlay if creation_time provided
    if creation_time:
        date_text = format_date_for_overlay(creation_time)
        # Escape special characters for FFmpeg drawtext
        date_text = date_text.replace("'", "\\'").replace(":", "\\:")
        vf_parts.append(
            f"drawtext=text='{date_text}':fontsize=48:fontcolor=0x87CEEB:x=40:y=40:"
            f"shadowcolor=black:shadowx=2:shadowy=2"
        )

    vf_filter = ','.join(vf_parts)

    # Always preserve original audio from video files
    subprocess.run([
        get_ffmpeg(), '-y',
        '-i', str(video_path),
        '-c:v', 'libx264',
        '-crf', '23',
        '-r', '30',  # Force 30fps for consistent timebase with xfade
        '-pix_fmt', 'yuv420p',
        '-vf', vf_filter,
        '-c:a', 'aac',
        '-b:a', '128k',
        str(output_path)
    ], check=True, capture_output=True)


def concatenate_videos(video_paths: List[Path], output_path: Path, source_is_video: List[bool] = None, crossfade_duration: float = CROSSFADE_DURATION):
    """
    Concatenate all video clips with crossfade transitions and audio.
    Crossfade only applied when transitioning from video to picture.
    Audio is trimmed to match video timeline and concatenated.

    Args:
        video_paths: List of processed clip paths (all must have audio tracks)
        output_path: Output file path
        source_is_video: List of booleans indicating if original source was video (True) or image (False)
        crossfade_duration: Duration of crossfade transitions
    """
    print(f"\nConcatenating {len(video_paths)} clips with audio...")

    if len(video_paths) == 0:
        raise ValueError("No video clips to concatenate")

    if len(video_paths) == 1:
        # Just copy single clip (preserves audio)
        shutil.copy(video_paths[0], output_path)
        return

    # Default: assume all are images if not specified (no crossfade)
    if source_is_video is None:
        source_is_video = [False] * len(video_paths)

    # Get actual durations from processed clips (more accurate than source durations)
    actual_durations = []
    for video_path in video_paths:
        actual_durations.append(get_video_duration(video_path))

    # Build FFmpeg inputs
    inputs = []
    for video_path in video_paths:
        inputs.extend(['-i', str(video_path)])

    # ========== BUILD FILTER COMPLEX ==========
    filter_parts = []

    # ----- VIDEO XFADE FILTER CHAIN -----
    cumulative_duration = actual_durations[0]
    crossfade_count = 0
    # Track audio durations (how much audio to take from each clip)
    audio_durations = []

    for i in range(len(video_paths) - 1):
        # Only apply crossfade when going from video to picture
        apply_crossfade = source_is_video[i] and not source_is_video[i + 1]
        transition_duration = crossfade_duration if apply_crossfade else 0.1

        if apply_crossfade:
            crossfade_count += 1

        # Calculate offset: when to start the transition
        offset = cumulative_duration - transition_duration
        if offset < 0.1:
            offset = 0.1

        # Track audio duration for this clip (plays until crossfade overlap begins)
        audio_durations.append(actual_durations[i] - transition_duration)

        # Input labels
        if i == 0:
            input1 = "[0:v]"
        else:
            input1 = f"[v{i}]"
        input2 = f"[{i+1}:v]"

        # Output label (final one should be [outv])
        if i == len(video_paths) - 2:
            output_label = "[outv]"
        else:
            output_label = f"[v{i+1}]"

        filter_parts.append(
            f"{input1}{input2}xfade=transition=fade:duration={transition_duration}:offset={offset:.3f}{output_label}"
        )

        cumulative_duration = offset + actual_durations[i+1]

    # Last clip uses full duration for audio
    audio_durations.append(actual_durations[-1])

    print(f"  Applying {crossfade_count} crossfade transitions (video->picture only)")

    # ----- AUDIO TRIM AND CONCAT FILTER CHAIN -----
    audio_inputs = []
    for i in range(len(video_paths)):
        audio_duration = max(audio_durations[i], 0.1)  # Ensure positive duration
        # Trim audio stream to calculated duration and reset timestamps
        filter_parts.append(f"[{i}:a]atrim=0:{audio_duration:.3f},asetpts=PTS-STARTPTS[a{i}]")
        audio_inputs.append(f"[a{i}]")

    # Concatenate all trimmed audio streams
    audio_concat = "".join(audio_inputs) + f"concat=n={len(video_paths)}:v=0:a=1[outa]"
    filter_parts.append(audio_concat)

    filter_complex = ";".join(filter_parts)

    # ========== BUILD FFMPEG COMMAND ==========
    cmd = [
        get_ffmpeg(), '-y',
        *inputs,
        '-filter_complex', filter_complex,
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-crf', '23',
        '-g', '30',               # Keyframe every 30 frames (1 second at 30fps)
        '-keyint_min', '30',      # Minimum keyframe interval
        '-sc_threshold', '0',     # Disable scene change detection for regular keyframes
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',  # Move moov atom to start for web seeking
        str(output_path)
    ]

    # Run with error output visible for debugging
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.stderr:
        stderr_lines = result.stderr.strip().split('\n')
        important_lines = [l for l in stderr_lines if 'error' in l.lower() or 'warning' in l.lower() or 'invalid' in l.lower() or 'failed' in l.lower()]
        if important_lines:
            print(f"  DEBUG: FFmpeg issues:")
            for line in important_lines[:20]:
                print(f"    {line}")
    if result.returncode != 0:
        raise subprocess.CalledProcessError(result.returncode, cmd)


def load_local_media() -> List[Tuple[Path, float, datetime, str, str]]:
    """
    Load media files from local temp_downloads directory.
    Used with --skip-download to avoid re-downloading from Drive.
    Returns list of (path, duration, date, file_id, filename) tuples sorted by filename.
    """
    print(f"\nLoading cached media from {TEMP_DOWNLOAD_DIR}")

    if not TEMP_DOWNLOAD_DIR.exists():
        print(f"[ERROR] Directory not found: {TEMP_DOWNLOAD_DIR}")
        return []

    local_media = []

    for file_path in TEMP_DOWNLOAD_DIR.iterdir():
        if not file_path.is_file():
            continue

        ext = file_path.suffix.lower()
        filename = file_path.name

        # Check if file should be skipped
        if should_skip_file(filename):
            print(f"Skipping (excluded): {filename}")
            continue

        # Check if it's a supported format
        if ext not in IMAGE_EXTENSIONS and ext not in VIDEO_EXTENSIONS:
            print(f"Skipping (unsupported format): {filename}")
            continue

        # Parse date from filename (PXL_YYYYMMDD_HHMMSS format)
        creation_time = parse_datetime_from_filename(filename) or datetime.now()

        # Determine duration
        if ext in IMAGE_EXTENSIONS:
            duration = parse_duration_from_filename(filename)
            if duration is None:
                duration = DEFAULT_IMAGE_DURATION
            local_media.append((file_path, float(duration), creation_time, '', filename))
        elif ext in VIDEO_EXTENSIONS:
            duration = get_video_duration(file_path)
            local_media.append((file_path, duration, creation_time, '', filename))

    # Sort by creation time (parsed from filename)
    local_media.sort(key=lambda x: x[2])

    print(f"Found {len(local_media)} cached media files")
    return local_media


def generate_compilation_metadata(clip_metadata: List[dict], source_is_video: List[bool], crossfade_duration: float = CROSSFADE_DURATION) -> dict:
    """
    Generate metadata about the compilation including month timestamps.
    Returns dict with months array containing start/end timestamps.
    """
    if not clip_metadata:
        return {'months': [], 'total_duration': 0, 'clip_count': 0}

    # Calculate timestamps for each clip, accounting for crossfade overlaps
    clip_timestamps = []
    cumulative_time = 0.0

    for i, clip in enumerate(clip_metadata):
        clip_start = cumulative_time
        clip_duration = clip['duration']

        # Calculate transition overlap with next clip (if any)
        if i < len(clip_metadata) - 1:
            # Crossfade only applies when going from video to picture
            apply_crossfade = source_is_video[i] and not source_is_video[i + 1]
            transition_duration = crossfade_duration if apply_crossfade else 0.1
            # The overlap reduces effective duration
            effective_duration = clip_duration - transition_duration
        else:
            effective_duration = clip_duration

        clip_timestamps.append({
            'month': clip['month'],
            'start': clip_start,
            'duration': clip_duration,
            'filename': clip['filename']
        })

        cumulative_time += max(effective_duration, 0.1)  # Ensure positive progress

    # Group clips by month and calculate month boundaries
    months_data = {}
    for clip in clip_timestamps:
        month = clip['month']
        if month not in months_data:
            months_data[month] = {
                'month': month,
                'start': clip['start'],
                'end': clip['start'] + clip['duration'],
                'clip_count': 0
            }
        months_data[month]['end'] = clip['start'] + clip['duration']
        months_data[month]['clip_count'] += 1

    # Convert to sorted list
    months_list = sorted(months_data.values(), key=lambda x: x['month'])

    return {
        'months': months_list,
        'total_duration': cumulative_time,
        'clip_count': len(clip_metadata),
        'generated_at': datetime.now().isoformat()
    }


def upload_to_gcs(local_file: Path, bucket_name: str, destination_blob_name: str):
    """Upload a file to Google Cloud Storage."""
    print(f"\nUploading to Google Cloud Storage...")
    print(f"  Bucket: {bucket_name}")
    print(f"  Destination: {destination_blob_name}")

    try:
        # Initialize GCS client
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(destination_blob_name)

        # Upload file
        blob.upload_from_filename(str(local_file))

        public_url = f"https://storage.googleapis.com/{bucket_name}/{destination_blob_name}"
        print(f"Upload successful!")
        print(f"  Public URL: {public_url}")

        return public_url

    except Exception as e:
        print(f"Upload failed: {e}")
        raise


def download_from_gcs(bucket_name: str, gcs_path: str, local_path: Path) -> bool:
    """Download a file from GCS. Returns True if successful, False if not found."""
    try:
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(gcs_path)
        if not blob.exists():
            return False
        blob.download_to_filename(str(local_path))
        return True
    except Exception as e:
        print(f"  Failed to download gs://{bucket_name}/{gcs_path}: {e}")
        return False


def get_month_manifest(bucket_name: str, month_str: str) -> Optional[dict]:
    """Download and parse manifest for a month from GCS. Returns None if not found."""
    try:
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(f"months/{month_str}-manifest.json")
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())
    except Exception as e:
        print(f"  Could not fetch manifest for {month_str}: {e}")
        return None


def month_needs_rebuild(drive_filenames: List[str], manifest: Optional[dict]) -> bool:
    """Check if month needs rebuilding by comparing sorted file lists."""
    if manifest is None:
        return True
    return sorted(drive_filenames) != sorted(manifest.get('files', []))


def build_month_video(service, month_name: str, month_folder_id: str,
                      output_path: Path, limit: int = None) -> Optional[dict]:
    """
    Download, process, and concatenate all clips for one month into a single video.
    Returns manifest dict on success, None on failure.
    """
    media_files = process_folder_media(service, month_folder_id, limit=limit)
    if not media_files:
        print(f"  No media files found for {month_name}")
        return None

    processed_clips = []
    source_is_video = []
    filenames = []

    for idx, (media_path, duration, creation_time, file_id, filename) in enumerate(media_files):
        ext = media_path.suffix.lower()
        output_clip = TEMP_DIR / f"month_{month_name}_clip_{idx:04d}.mp4"

        try:
            if ext in IMAGE_EXTENSIONS:
                process_image_to_video(media_path, duration, output_clip, creation_time)
                source_is_video.append(False)
            elif ext in VIDEO_EXTENSIONS:
                standardize_video(media_path, output_clip, creation_time)
                source_is_video.append(True)

            processed_clips.append(output_clip)
            filenames.append(filename)
        except subprocess.CalledProcessError as e:
            print(f"  ERROR processing {media_path.name}: {e}")
            continue

    if not processed_clips:
        return None

    # Concatenate clips for this month (with crossfades)
    concatenate_videos(processed_clips, output_path, source_is_video)

    # Get actual duration of the month video
    month_duration = get_video_duration(output_path)

    # Clean up individual clips
    for clip in processed_clips:
        try:
            clip.unlink()
        except Exception:
            pass

    return {
        'month': month_name,
        'files': sorted(filenames),
        'duration': month_duration,
        'clip_count': len(processed_clips),
        'built_at': datetime.now().isoformat()
    }


def concat_month_videos(month_video_paths: List[Path], output_path: Path):
    """
    Concatenate per-month videos using FFmpeg concat demuxer.
    Fast stream copy — no re-encoding, minimal memory.
    """
    print(f"\nConcatenating {len(month_video_paths)} month videos into final compilation...")

    if len(month_video_paths) == 0:
        raise ValueError("No month videos to concatenate")

    if len(month_video_paths) == 1:
        shutil.copy(month_video_paths[0], output_path)
        return

    # Create concat list file
    concat_list = TEMP_DIR / "month_concat_list.txt"
    with open(concat_list, 'w') as f:
        for video_path in month_video_paths:
            safe_path = str(video_path).replace('\\', '/')
            f.write(f"file '{safe_path}'\n")

    cmd = [
        get_ffmpeg(), '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', str(concat_list),
        '-c', 'copy',
        '-movflags', '+faststart',
        str(output_path)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  FFmpeg concat error: {result.stderr[-500:] if result.stderr else 'unknown'}")
        raise subprocess.CalledProcessError(result.returncode, cmd)


def generate_metadata_from_months(month_manifests: List[dict]) -> dict:
    """Generate compilation metadata from per-month manifest data."""
    months_data = []
    cumulative_time = 0.0
    total_clips = 0

    for manifest in month_manifests:
        month_start = cumulative_time
        month_duration = manifest['duration']

        months_data.append({
            'month': manifest['month'],
            'start': month_start,
            'end': month_start + month_duration,
            'clip_count': manifest['clip_count']
        })

        cumulative_time += month_duration
        total_clips += manifest['clip_count']

    return {
        'months': months_data,
        'total_duration': cumulative_time,
        'clip_count': total_clips,
        'generated_at': datetime.now().isoformat()
    }


def main():
    """Main processing logic."""
    parser = argparse.ArgumentParser(description='Process Google Drive folder into compilation video')
    parser.add_argument('--auth-only', action='store_true', help='Only perform authentication')
    parser.add_argument('--list-folders', action='store_true', help='List all folders and their IDs')
    parser.add_argument('--folder-id', type=str, help='Google Drive folder ID to process')
    parser.add_argument('--upload-to-gcs', action='store_true', help='Upload result to Google Cloud Storage')
    parser.add_argument('--gcs-bucket', type=str, help='GCS bucket name')
    parser.add_argument('--gcs-path', type=str, default='compilation.mp4', help='Destination path in GCS bucket')
    parser.add_argument('--delete-after-process', action='store_true', help='Delete source files from Drive after processing (not recommended with incremental builds)')
    parser.add_argument('--skip-download', action='store_true', help='Use locally cached files (legacy monolithic mode)')
    parser.add_argument('--limit', type=int, default=None, help='Limit number of files per folder (useful for testing)')
    parser.add_argument('--start-month', type=str, help='Start of month range (YYYY-MM, inclusive)')
    parser.add_argument('--end-month', type=str, help='End of month range (YYYY-MM, inclusive)')
    parser.add_argument('--force-rebuild', action='store_true', help='Rebuild all months regardless of GCS manifests')
    parser.add_argument('--latest-only', action='store_true', help='Only build latest.mp4 from the most recent N clips (fast)')
    parser.add_argument('--latest-count', type=int, default=10, help='Number of recent clips for latest.mp4 (default: 10)')

    args = parser.parse_args()

    print("=" * 60)
    print("Visual Stitch Media Processor (Google Drive Edition)")
    if args.latest_only:
        print(f"  ** LATEST ONLY: building latest.mp4 from last {args.latest_count} clips **")
    if args.limit:
        print(f"  ** TEST MODE: limiting to {args.limit} files per folder **")
    if args.force_rebuild:
        print(f"  ** FORCE REBUILD: all months will be rebuilt **")
    print("=" * 60)

    # Get credentials
    try:
        creds = get_credentials()
    except Exception as e:
        print(f"\n[ERROR] Authentication failed: {e}")
        print("\nPlease ensure client_secret.json is in the Visual-Stitch directory")
        return 1

    # Build Drive service (helper to rebuild on stale connections)
    def build_service():
        return build('drive', 'v3', credentials=creds)

    service = build_service()

    # Handle auth-only mode
    if args.auth_only:
        print("\n[OK] Authentication successful!")
        return 0

    # Handle list-folders mode
    if args.list_folders:
        list_folders(service)
        return 0

    # Ensure directories exist
    OUTPUT_DIR.mkdir(exist_ok=True)
    TEMP_DIR.mkdir(exist_ok=True)
    TEMP_DOWNLOAD_DIR.mkdir(exist_ok=True)

    # ===== LATEST-ONLY MODE =====
    if args.latest_only:
        folder_id = args.folder_id or os.environ.get('GOOGLE_DRIVE_FOLDER_ID')
        if not folder_id:
            local_config_path = SCRIPT_DIR / 'local-config.json'
            if local_config_path.exists():
                with open(local_config_path) as f:
                    folder_id = json.load(f).get('folder_id')
        if not folder_id:
            print("\n[ERROR] No folder ID provided!")
            return 1

        bucket_name = args.gcs_bucket or os.environ.get('GCS_BUCKET_NAME')

        # Discover month subfolders (sorted chronologically)
        month_subfolders = get_month_subfolders(service, folder_id)
        if not month_subfolders:
            print("\nNo YYYY-MM subfolders found!")
            return 1

        # Collect the last N files across all months (most recent first)
        target_count = args.latest_count
        collected_items = []  # (month_folder_id, item_dict)

        for month_folder in reversed(month_subfolders):
            if len(collected_items) >= target_count:
                break
            service = build_service()  # fresh connection
            items = get_media_from_folder(service, month_folder['id'])
            # Filter to supported formats
            valid_items = [
                item for item in items
                if not should_skip_file(item.get('name', ''))
                and get_file_extension(item.get('mimeType', ''), item.get('name', '')) in ALL_EXTENSIONS
            ]
            # Take from the end (most recent files) of this month
            needed = target_count - len(collected_items)
            for item in reversed(valid_items[-needed:]):
                collected_items.append((month_folder['id'], item))
            # If we got items from this month but still need more, they came from the end

        if not collected_items:
            print("\n[ERROR] No clips found!")
            return 1

        # Reverse so clips are in chronological order
        collected_items.reverse()

        print(f"\nBuilding latest.mp4 from {len(collected_items)} most recent clips...")

        # Download and process each clip
        service = build_service()
        processed_clips = []
        source_is_video = []

        for idx, (folder_id_item, item) in enumerate(collected_items):
            filename = item.get('name', f'item_{idx}')
            mime_type = item.get('mimeType', '')
            file_id = item['id']
            ext = get_file_extension(mime_type, filename)

            local_path = TEMP_DOWNLOAD_DIR / filename
            if not local_path.exists():
                print(f"  Downloading: {filename}")
                if not download_drive_file(service, file_id, filename, local_path):
                    continue
            else:
                print(f"  Using cached: {filename}")

            # Get creation time
            creation_time = parse_datetime_from_filename(filename)
            if not creation_time:
                exif_time = (item.get('imageMediaMetadata') or {}).get('time')
                if exif_time:
                    try:
                        creation_time = datetime.strptime(exif_time, '%Y:%m:%d %H:%M:%S')
                    except ValueError:
                        pass
            if not creation_time:
                creation_time_str = item.get('createdTime') or item.get('modifiedTime')
                if creation_time_str:
                    creation_time = datetime.fromisoformat(creation_time_str.replace('Z', '+00:00')).replace(tzinfo=None)
                else:
                    creation_time = datetime.now()

            output_clip = TEMP_DIR / f"latest_clip_{idx:04d}.mp4"
            try:
                if ext in IMAGE_EXTENSIONS:
                    duration = parse_duration_from_filename(filename) or DEFAULT_IMAGE_DURATION
                    process_image_to_video(local_path, float(duration), output_clip, creation_time)
                    source_is_video.append(False)
                elif ext in VIDEO_EXTENSIONS:
                    standardize_video(local_path, output_clip, creation_time)
                    source_is_video.append(True)
                processed_clips.append(output_clip)
            except subprocess.CalledProcessError as e:
                print(f"  ERROR processing {filename}: {e}")
                continue

        if not processed_clips:
            print("\n[ERROR] No clips processed!")
            return 1

        # Concatenate into latest.mp4
        latest_video_path = OUTPUT_DIR / "latest.mp4"
        concatenate_videos(processed_clips, latest_video_path, source_is_video)

        # Clean up clips
        for clip in processed_clips:
            try:
                clip.unlink()
            except Exception:
                pass

        print(f"\nSUCCESS! latest.mp4 created ({len(processed_clips)} clips)")

        # Upload to GCS
        if args.upload_to_gcs:
            if not bucket_name:
                print("\n[ERROR] No GCS bucket specified!")
                return 1
            upload_to_gcs(latest_video_path, bucket_name, 'latest.mp4')
            print(f"[OK] latest.mp4 uploaded to GCS")

        return 0

    # ===== LEGACY MODE: --skip-download =====
    if args.skip_download:
        media_files = load_local_media()
        if not media_files:
            print("\n[ERROR] No media files to process!")
            return 1

        print(f"\nProcessing {len(media_files)} media files (legacy mode)...")
        processed_clips = []
        source_is_video = []
        clip_metadata = []

        for idx, (media_path, duration, creation_time, file_id, filename) in enumerate(media_files):
            ext = media_path.suffix.lower()
            output_clip = TEMP_DIR / f"clip_{idx:04d}.mp4"
            clip_month = get_month_from_datetime(creation_time)

            try:
                if ext in IMAGE_EXTENSIONS:
                    process_image_to_video(media_path, duration, output_clip, creation_time)
                    source_is_video.append(False)
                elif ext in VIDEO_EXTENSIONS:
                    standardize_video(media_path, output_clip, creation_time)
                    source_is_video.append(True)

                processed_clips.append(output_clip)
                clip_metadata.append({'month': clip_month, 'duration': duration, 'filename': filename})
            except subprocess.CalledProcessError as e:
                print(f"  ERROR processing {media_path.name}: {e}")
                continue

        if not processed_clips:
            print("\n[ERROR] No clips were successfully processed!")
            return 1

        concatenate_videos(processed_clips, OUTPUT_VIDEO, source_is_video)
        metadata = generate_compilation_metadata(clip_metadata, source_is_video)
        metadata_path = OUTPUT_DIR / "compilation-metadata.json"
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)

        print(f"\n{'=' * 60}")
        print(f"SUCCESS! Compilation video created: {OUTPUT_VIDEO}")
        print(f"{'=' * 60}")
        return 0

    # ===== INCREMENTAL PER-MONTH MODE =====

    # Get folder ID
    folder_id = args.folder_id or os.environ.get('GOOGLE_DRIVE_FOLDER_ID')
    if not folder_id:
        local_config_path = SCRIPT_DIR / 'local-config.json'
        if local_config_path.exists():
            with open(local_config_path) as f:
                folder_id = json.load(f).get('folder_id')
            if folder_id:
                print(f"Using folder ID from local-config.json")
    if not folder_id:
        print("\n[ERROR] No folder ID provided!")
        print("Use --folder-id, local-config.json, or set GOOGLE_DRIVE_FOLDER_ID environment variable")
        return 1

    # Get GCS bucket name (needed for incremental manifest checks)
    bucket_name = args.gcs_bucket or os.environ.get('GCS_BUCKET_NAME')

    # Discover month subfolders
    month_subfolders = get_month_subfolders(service, folder_id)

    if not month_subfolders:
        print("\nNo YYYY-MM subfolders found. Please organize media into month folders (e.g., 2025-10/)")
        return 1

    # Apply month range filter
    month_subfolders = filter_folders_by_range(month_subfolders, args.start_month, args.end_month)
    if not month_subfolders:
        print("\n[ERROR] No folders match the specified month range!")
        return 1

    print(f"\nFound {len(month_subfolders)} month folder(s):")
    for mf in month_subfolders:
        print(f"  - {mf['name']}")

    # Per-month video directory
    MONTH_VIDEO_DIR = TEMP_DIR / "months"
    MONTH_VIDEO_DIR.mkdir(exist_ok=True)

    # Process each month incrementally
    month_results = []  # (month_name, video_path, manifest)
    rebuilt_count = 0
    skipped_count = 0

    for month_folder in month_subfolders:
        month_name = month_folder['name']
        month_video_path = MONTH_VIDEO_DIR / f"{month_name}.mp4"

        # Rebuild Drive service to avoid stale SSL connections
        # (processing a month can take 10+ minutes, killing the connection)
        service = build_service()

        # Check if rebuild is needed
        needs_rebuild = args.force_rebuild
        if not needs_rebuild and bucket_name:
            # Get file list from Drive for comparison
            drive_items = get_media_from_folder(service, month_folder['id'], limit=args.limit)
            drive_filenames = sorted([
                item.get('name', '') for item in drive_items
                if not should_skip_file(item.get('name', ''))
                and get_file_extension(item.get('mimeType', ''), item.get('name', '')) in ALL_EXTENSIONS
            ])

            # Compare against GCS manifest
            manifest = get_month_manifest(bucket_name, month_name)
            needs_rebuild = month_needs_rebuild(drive_filenames, manifest)

            if not needs_rebuild:
                print(f"\n--- {month_name}: unchanged ({manifest['clip_count']} clips) ---")
                if download_from_gcs(bucket_name, f"months/{month_name}.mp4", month_video_path):
                    month_results.append((month_name, month_video_path, manifest))
                    skipped_count += 1
                    continue
                else:
                    print(f"  GCS download failed, rebuilding...")
                    needs_rebuild = True
        else:
            needs_rebuild = True

        # Rebuild this month
        print(f"\n--- {month_name}: building ---")
        manifest = build_month_video(service, month_name, month_folder['id'],
                                      month_video_path, limit=args.limit)

        if manifest:
            month_results.append((month_name, month_video_path, manifest))
            rebuilt_count += 1

            # Upload month video + manifest to GCS
            if args.upload_to_gcs and bucket_name:
                upload_to_gcs(month_video_path, bucket_name, f"months/{month_name}.mp4")
                manifest_tmp = TEMP_DIR / f"{month_name}-manifest.json"
                with open(manifest_tmp, 'w') as f:
                    json.dump(manifest, f, indent=2)
                upload_to_gcs(manifest_tmp, bucket_name, f"months/{month_name}-manifest.json")
        else:
            print(f"  WARNING: Failed to build {month_name}, skipping")

    if not month_results:
        print("\n[ERROR] No month videos produced!")
        return 1

    # Sort chronologically
    month_results.sort(key=lambda x: x[0])

    print(f"\n{'=' * 60}")
    print(f"Month summary: {rebuilt_count} rebuilt, {skipped_count} unchanged")
    print(f"{'=' * 60}")

    # Concatenate all month videos into final compilation
    month_video_paths = [mr[1] for mr in month_results]
    concat_month_videos(month_video_paths, OUTPUT_VIDEO)

    # Generate compilation metadata from month manifests
    month_manifests = [mr[2] for mr in month_results]
    metadata = generate_metadata_from_months(month_manifests)
    metadata_path = OUTPUT_DIR / "compilation-metadata.json"
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"\nMetadata: {metadata['clip_count']} clips across {len(metadata['months'])} months")

    print(f"\n{'=' * 60}")
    print(f"SUCCESS! Compilation: {OUTPUT_VIDEO}")
    print(f"  Months: {len(month_results)}")
    print(f"  Total clips: {metadata['clip_count']}")
    print(f"{'=' * 60}")

    # Upload to GCS
    if args.upload_to_gcs:
        if not bucket_name:
            print("\n[ERROR] No GCS bucket specified!")
            print("Use --gcs-bucket or set GCS_BUCKET_NAME environment variable")
            return 1

        try:
            upload_to_gcs(OUTPUT_VIDEO, bucket_name, args.gcs_path)
            metadata_gcs_path = args.gcs_path.replace('.mp4', '-metadata.json')
            upload_to_gcs(metadata_path, bucket_name, metadata_gcs_path)
            print(f"\n[OK] Compilation + metadata uploaded to GCS")
        except Exception as e:
            print(f"\n[ERROR] Upload failed: {e}")
            return 1

    # Warn if delete-after-process is used (not recommended with incremental builds)
    if args.delete_after_process:
        print("\nWARNING: --delete-after-process is not recommended with incremental builds.")
        print("Drive folders are the source of truth for change detection.")

    return 0

if __name__ == "__main__":
    sys.exit(main())
