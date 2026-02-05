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


def get_media_from_folder(service, folder_id: str) -> List[dict]:
    """
    Fetch all media files from a specific Google Drive folder.
    Returns list of file dictionaries.
    """
    print(f"\nFetching media from folder: {folder_id}")

    # Build query for supported media types
    mime_queries = [
        "mimeType contains 'image/'",
        "mimeType contains 'video/'"
    ]
    mime_query = " or ".join(mime_queries)
    query = f"'{folder_id}' in parents and ({mime_query}) and trashed=false"

    try:
        media_items = []
        page_token = None

        while True:
            results = service.files().list(
                q=query,
                pageSize=100,
                fields="nextPageToken, files(id, name, mimeType, createdTime, modifiedTime)",
                pageToken=page_token
            ).execute()

            items = results.get('files', [])
            media_items.extend(items)

            page_token = results.get('nextPageToken')
            if not page_token:
                break

        print(f"Found {len(media_items)} media items in folder")
        return media_items

    except HttpError as error:
        print(f"An error occurred: {error}")
        return []


def download_drive_file(service, file_id: str, filename: str, output_path: Path) -> bool:
    """
    Download a file from Google Drive.
    Returns True if successful, False otherwise.
    """
    try:
        request = service.files().get_media(fileId=file_id)

        with open(output_path, 'wb') as f:
            downloader = MediaIoBaseDownload(f, request)
            done = False
            while not done:
                status, done = downloader.next_chunk()

        return True

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


def process_folder_media(service, folder_id: str) -> List[Tuple[Path, float, datetime, str, str]]:
    """
    Download and catalog media from Google Drive folder.
    Returns list of (path, duration, date, file_id, filename) tuples sorted chronologically.
    """
    # Get media items from folder
    media_items = get_media_from_folder(service, folder_id)

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

        # Get creation time - prefer filename (actual capture time) over Drive metadata (upload time)
        creation_time = parse_datetime_from_filename(filename)
        if not creation_time:
            # Fall back to Drive metadata
            creation_time_str = item.get('createdTime') or item.get('modifiedTime')
            if creation_time_str:
                # Convert to naive datetime (strip timezone) for consistent sorting
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


def main():
    """Main processing logic."""
    parser = argparse.ArgumentParser(description='Process Google Drive folder into compilation video')
    parser.add_argument('--auth-only', action='store_true', help='Only perform authentication')
    parser.add_argument('--list-folders', action='store_true', help='List all folders and their IDs')
    parser.add_argument('--folder-id', type=str, help='Google Drive folder ID to process')
    parser.add_argument('--upload-to-gcs', action='store_true', help='Upload result to Google Cloud Storage')
    parser.add_argument('--gcs-bucket', type=str, help='GCS bucket name')
    parser.add_argument('--gcs-path', type=str, default='compilation.mp4', help='Destination path in GCS bucket')
    parser.add_argument('--delete-after-process', action='store_true', help='Delete source files from Drive after successful processing')
    parser.add_argument('--skip-download', action='store_true', help='Use locally cached files from temp_downloads instead of downloading from Drive')
    parser.add_argument('--start-month', type=str, help='Start of month range (YYYY-MM, inclusive)')
    parser.add_argument('--end-month', type=str, help='End of month range (YYYY-MM, inclusive)')

    args = parser.parse_args()

    print("=" * 60)
    print("Visual Stitch Media Processor (Google Drive Edition)")
    print("=" * 60)

    # Get credentials
    try:
        creds = get_credentials()
    except Exception as e:
        print(f"\n[ERROR] Authentication failed: {e}")
        print("\nPlease ensure client_secret.json is in the Visual-Stitch directory")
        return 1

    # Build Drive service
    service = build('drive', 'v3', credentials=creds)

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

    # Handle skip-download mode (use cached local files)
    if args.skip_download:
        media_files = load_local_media()
    else:
        # Get folder ID from args or environment
        folder_id = args.folder_id or os.environ.get('GOOGLE_DRIVE_FOLDER_ID')
        if not folder_id:
            print("\n[ERROR] No folder ID provided!")
            print("Use --folder-id or set GOOGLE_DRIVE_FOLDER_ID environment variable")
            print("Run with --list-folders to see available folders")
            return 1

        # Check for YYYY-MM month subfolders
        month_subfolders = get_month_subfolders(service, folder_id)

        if month_subfolders:
            # Multi-folder mode: process each month subfolder
            month_subfolders = filter_folders_by_range(month_subfolders, args.start_month, args.end_month)

            if not month_subfolders:
                print("\n[ERROR] No folders match the specified month range!")
                return 1

            print(f"\nFound {len(month_subfolders)} month folder(s) to process:")
            for mf in month_subfolders:
                print(f"  - {mf['name']}")

            # Collect media from all month folders
            media_files = []
            for month_folder in month_subfolders:
                print(f"\n--- Processing {month_folder['name']} ---")
                folder_media = process_folder_media(service, month_folder['id'])
                media_files.extend(folder_media)

            # Sort all media chronologically across all months
            media_files.sort(key=lambda x: x[2])
            print(f"\nTotal media files across all months: {len(media_files)}")
        else:
            # Backward compatibility: treat as flat folder with media files
            print("\nNo YYYY-MM subfolders found, treating as flat media folder...")
            media_files = process_folder_media(service, folder_id)

    if not media_files:
        print("\n[ERROR] No media files to process!")
        return 1

    print(f"\nProcessing {len(media_files)} media files...")

    # Process each media file
    processed_clips = []
    source_is_video = []  # Track whether each clip came from a video (for crossfade logic)
    clip_metadata = []  # Track (month, duration) for each clip for timestamp calculation
    successfully_processed_files = []  # Track (file_id, filename) for deletion

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
            successfully_processed_files.append((file_id, filename))

        except subprocess.CalledProcessError as e:
            print(f"  ERROR processing {media_path.name}: {e}")
            continue

    if not processed_clips:
        print("\n[ERROR] No clips were successfully processed!")
        return 1

    # Concatenate all clips with crossfade transitions (only on video->picture)
    concatenate_videos(processed_clips, OUTPUT_VIDEO, source_is_video)

    # Generate compilation metadata with month timestamps
    metadata = generate_compilation_metadata(clip_metadata, source_is_video)
    metadata_path = OUTPUT_DIR / "compilation-metadata.json"
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"\nMetadata generated: {len(metadata['months'])} months, {metadata['clip_count']} clips")

    print(f"\n{'=' * 60}")
    print(f"SUCCESS! Compilation video created:")
    print(f"  {OUTPUT_VIDEO}")
    print(f"  Total clips: {len(processed_clips)}")
    print(f"{'=' * 60}")

    # Upload to GCS if requested
    if args.upload_to_gcs:
        bucket_name = args.gcs_bucket or os.environ.get('GCS_BUCKET_NAME')
        if not bucket_name:
            print("\n[ERROR] No GCS bucket specified!")
            print("Use --gcs-bucket or set GCS_BUCKET_NAME environment variable")
            return 1

        try:
            public_url = upload_to_gcs(OUTPUT_VIDEO, bucket_name, args.gcs_path)
            print(f"\n[OK] Video is now publicly accessible at:")
            print(f"  {public_url}")

            # Also upload metadata JSON
            metadata_gcs_path = args.gcs_path.replace('.mp4', '-metadata.json')
            upload_to_gcs(metadata_path, bucket_name, metadata_gcs_path)
            print(f"[OK] Metadata uploaded to: {metadata_gcs_path}")
        except Exception as e:
            print(f"\n[ERROR] Upload failed: {e}")
            return 1

    # Delete source files from Drive if requested (only after successful processing, not with --skip-download)
    if args.delete_after_process and successfully_processed_files and not args.skip_download:
        print(f"\nDeleting {len(successfully_processed_files)} processed files from Google Drive...")
        deleted_count = 0
        for file_id, filename in successfully_processed_files:
            if delete_drive_file(service, file_id, filename):
                deleted_count += 1
        print(f"[OK] Deleted {deleted_count}/{len(successfully_processed_files)} files from Drive")

    return 0

if __name__ == "__main__":
    sys.exit(main())
