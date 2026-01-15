#!/usr/bin/env python3
"""
Media Processing Script for Visual Stitch with Google Photos API
Fetches media from Google Photos albums, processes images and videos,
and stitches them into one compilation video.
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

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.cloud import storage
import requests

# Configuration
SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR / "output"
TEMP_DIR = SCRIPT_DIR / "temp_processed"
TEMP_DOWNLOAD_DIR = SCRIPT_DIR / "temp_downloads"
OUTPUT_VIDEO = OUTPUT_DIR / "compilation.mp4"
DEFAULT_IMAGE_DURATION = 3  # seconds

# Google Photos API scopes
# Note: photoslibrary (full access) is needed because readonly doesn't grant album listing
SCOPES = ['https://www.googleapis.com/auth/photoslibrary']

# Supported formats
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'}
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.avi', '.mkv', '.m4v', '.3gp'}

def get_credentials() -> Credentials:
    """
    Get Google Photos API credentials using OAuth 2.0.
    Looks for token.json for existing auth, or client_secret.json for new auth.
    """
    creds = None
    token_path = SCRIPT_DIR / 'token.json'
    client_secret_path = SCRIPT_DIR / 'client_secret.json'

    # Check for token in environment variable (for GitHub Actions)
    token_json = os.environ.get('GOOGLE_PHOTOS_TOKEN')
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
            client_secret_json = os.environ.get('GOOGLE_PHOTOS_CLIENT_SECRET')
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

        print(f"\n✓ Authentication successful! Token saved to {token_path}")
        print(f"Add this token to GitHub Secrets as GOOGLE_PHOTOS_TOKEN:\n")
        print(creds.to_json())

    return creds

def list_albums(service) -> List[dict]:
    """List all albums in the user's Google Photos."""
    try:
        results = service.albums().list(pageSize=50).execute()
        albums = results.get('albums', [])

        if not albums:
            print("No albums found.")
            return []

        print("\n" + "=" * 60)
        print("Your Google Photos Albums:")
        print("=" * 60)
        for album in albums:
            title = album.get('title', 'Untitled')
            album_id = album['id']
            item_count = album.get('mediaItemsCount', 'Unknown')
            print(f"\nAlbum: {title}")
            print(f"  ID: {album_id}")
            print(f"  Items: {item_count}")
        print("=" * 60)

        return albums

    except HttpError as error:
        print(f"An error occurred: {error}")
        return []

def parse_duration_from_filename(filename: str) -> Optional[int]:
    """
    Extract duration from filename with _Xs suffix (e.g., sunset_5s.jpg -> 5)
    Returns None if no duration suffix found.
    """
    match = re.search(r'_(\d+)s\.', filename, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None

def should_skip_file(filename: str) -> bool:
    """Check if filename indicates it should be skipped (starts with _SKIP_)."""
    return filename.startswith('_SKIP_')

def get_media_from_album(service, album_id: str) -> List[dict]:
    """
    Fetch all media items from a specific Google Photos album.
    Returns list of media item dictionaries.
    """
    print(f"\nFetching media from album: {album_id}")

    try:
        media_items = []
        page_token = None

        while True:
            body = {
                'albumId': album_id,
                'pageSize': 100
            }
            if page_token:
                body['pageToken'] = page_token

            results = service.mediaItems().search(body=body).execute()
            items = results.get('mediaItems', [])
            media_items.extend(items)

            page_token = results.get('nextPageToken')
            if not page_token:
                break

        print(f"Found {len(media_items)} media items in album")
        return media_items

    except HttpError as error:
        print(f"An error occurred: {error}")
        return []

def download_media_item(item: dict, output_path: Path) -> bool:
    """
    Download a media item from Google Photos.
    Returns True if successful, False otherwise.
    """
    try:
        # Get base URL
        base_url = item['baseUrl']

        # Determine if it's a video or image
        mime_type = item['mimeType']
        if mime_type.startswith('video/'):
            # For videos, append =dv to download
            download_url = f"{base_url}=dv"
        else:
            # For images, append =d to download original
            download_url = f"{base_url}=d"

        # Download the file
        response = requests.get(download_url, stream=True)
        response.raise_for_status()

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        return True

    except Exception as e:
        print(f"  Error downloading {item.get('filename', 'unknown')}: {e}")
        return False

def get_file_extension(mime_type: str) -> str:
    """Convert MIME type to file extension."""
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

def process_album_media(service, album_id: str) -> List[Tuple[Path, float, datetime]]:
    """
    Download and catalog media from Google Photos album.
    Returns list of (path, duration, date) tuples sorted chronologically.
    """
    # Get media items from album
    media_items = get_media_from_album(service, album_id)

    if not media_items:
        print("No media items found in album!")
        return []

    # Ensure temp download directory exists
    TEMP_DOWNLOAD_DIR.mkdir(exist_ok=True)

    processed_media = []

    for idx, item in enumerate(media_items):
        filename = item.get('filename', f'item_{idx}')
        mime_type = item.get('mimeType', '')

        # Check if file should be skipped
        if should_skip_file(filename):
            print(f"Skipping (excluded): {filename}")
            continue

        # Get file extension
        ext = get_file_extension(mime_type)

        # Check if it's a supported format
        if ext not in IMAGE_EXTENSIONS and ext not in VIDEO_EXTENSIONS:
            print(f"Skipping (unsupported format): {filename}")
            continue

        # Create local path preserving original filename
        local_path = TEMP_DOWNLOAD_DIR / filename

        # Download the file
        print(f"Downloading: {filename}")
        if not download_media_item(item, local_path):
            continue

        # Get creation time
        creation_time_str = item.get('mediaMetadata', {}).get('creationTime')
        if creation_time_str:
            creation_time = datetime.fromisoformat(creation_time_str.replace('Z', '+00:00'))
        else:
            creation_time = datetime.now()

        # Determine duration
        if ext in IMAGE_EXTENSIONS:
            # Check for duration in filename
            duration = parse_duration_from_filename(filename)
            if duration is None:
                duration = DEFAULT_IMAGE_DURATION
            processed_media.append((local_path, float(duration), creation_time))

        elif ext in VIDEO_EXTENSIONS:
            duration = get_video_duration(local_path)
            processed_media.append((local_path, duration, creation_time))

    # Sort by creation time (chronological)
    processed_media.sort(key=lambda x: x[2])

    return processed_media

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

        # Note: make_public() doesn't work with uniform bucket-level access
        # Public access should be configured at the bucket level instead
        public_url = f"https://storage.googleapis.com/{bucket_name}/{destination_blob_name}"
        print(f"Upload successful!")
        print(f"  Public URL: {public_url}")

        return public_url

    except Exception as e:
        print(f"Upload failed: {e}")
        raise

def main():
    """Main processing logic."""
    parser = argparse.ArgumentParser(description='Process Google Photos album into compilation video')
    parser.add_argument('--auth-only', action='store_true', help='Only perform authentication')
    parser.add_argument('--list-albums', action='store_true', help='List all albums and their IDs')
    parser.add_argument('--album-id', type=str, help='Google Photos album ID to process')
    parser.add_argument('--upload-to-gcs', action='store_true', help='Upload result to Google Cloud Storage')
    parser.add_argument('--gcs-bucket', type=str, help='GCS bucket name')
    parser.add_argument('--gcs-path', type=str, default='compilation.mp4', help='Destination path in GCS bucket')

    args = parser.parse_args()

    print("=" * 60)
    print("Visual Stitch Media Processor (Google Photos Edition)")
    print("=" * 60)

    # Get credentials
    try:
        creds = get_credentials()
    except Exception as e:
        print(f"\n✗ Authentication failed: {e}")
        print("\nPlease follow the setup guide in SETUP_GUIDE.md")
        return 1

    # Build service
    service = build('photoslibrary', 'v1', credentials=creds, static_discovery=False)

    # Handle auth-only mode
    if args.auth_only:
        print("\n✓ Authentication successful!")
        return 0

    # Handle list-albums mode
    if args.list_albums:
        list_albums(service)
        return 0

    # Get album ID from args or environment
    album_id = args.album_id or os.environ.get('GOOGLE_PHOTOS_ALBUM_ID')
    if not album_id:
        print("\n✗ No album ID provided!")
        print("Use --album-id or set GOOGLE_PHOTOS_ALBUM_ID environment variable")
        print("Run with --list-albums to see available albums")
        return 1

    # Ensure directories exist
    OUTPUT_DIR.mkdir(exist_ok=True)
    TEMP_DIR.mkdir(exist_ok=True)
    TEMP_DOWNLOAD_DIR.mkdir(exist_ok=True)

    # Process media from album
    media_files = process_album_media(service, album_id)

    if not media_files:
        print("\n✗ No media files to process!")
        return 1

    print(f"\nProcessing {len(media_files)} media files...")

    # Process each media file
    processed_clips = []

    for idx, (media_path, duration, creation_time) in enumerate(media_files):
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
        print("\n✗ No clips were successfully processed!")
        return 1

    # Concatenate all clips
    concatenate_videos(processed_clips, OUTPUT_VIDEO)

    print(f"\n{'=' * 60}")
    print(f"SUCCESS! Compilation video created:")
    print(f"  {OUTPUT_VIDEO}")
    print(f"  Total clips: {len(processed_clips)}")
    print(f"{'=' * 60}")

    # Upload to GCS if requested
    if args.upload_to_gcs:
        bucket_name = args.gcs_bucket or os.environ.get('GCS_BUCKET_NAME')
        if not bucket_name:
            print("\n✗ No GCS bucket specified!")
            print("Use --gcs-bucket or set GCS_BUCKET_NAME environment variable")
            return 1

        try:
            public_url = upload_to_gcs(OUTPUT_VIDEO, bucket_name, args.gcs_path)
            print(f"\n✓ Video is now publicly accessible at:")
            print(f"  {public_url}")
        except Exception as e:
            print(f"\n✗ Upload failed: {e}")
            return 1

    return 0

if __name__ == "__main__":
    sys.exit(main())
