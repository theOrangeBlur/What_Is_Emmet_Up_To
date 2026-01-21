# Visual Stitch - Automated Video Compilation

An automated system that stitches photos and videos from Google Photos into one compilation video, updating weekly via GitHub Actions.

## 🚀 New: Google Photos Integration!

This system now pulls media directly from your Google Photos albums. No more downloading files or committing large videos to git!

### Quick Start

**New to this system?** Follow [QUICK_START.md](./QUICK_START.md)

**Migrating from local files?** See [MIGRATION_SUMMARY.md](./MIGRATION_SUMMARY.md)

**Detailed setup?** Check [SETUP_GUIDE.md](./SETUP_GUIDE.md)

## How It Works

```
Google Photos Album → GitHub Actions (weekly) → Google Cloud Storage → Your Website
```

1. **Add Media**: Upload photos/videos to your Google Photos album
2. **Name Files**: Use `_5s` suffix for duration, `_SKIP_` prefix to exclude
3. **Automatic Processing**: GitHub Actions runs every Monday at 00:00 UTC
4. **Video Hosted**: Compilation uploaded to Google Cloud Storage
5. **Website Updates**: Your page loads the latest video automatically

## File Naming Convention

Control video behavior with filenames in Google Photos:

### Images
- `photo.jpg` → 3 seconds (default)
- `photo_5s.jpg` → 5 seconds
- `photo_1s.jpg` → 1 second
- `_SKIP_photo.jpg` → Excluded from compilation

### Videos
- `video.mp4` → Full video duration
- `_SKIP_video.mp4` → Excluded from compilation

## Setup Checklist

- [ ] Enable Google Photos API & Cloud Storage API
- [ ] Create OAuth 2.0 credentials
- [ ] Create GCS bucket for video hosting
- [ ] Create service account for GitHub Actions
- [ ] Authenticate locally to get token
- [ ] Add 5 secrets to GitHub
- [ ] Update HTML with your bucket name
- [ ] Test!

See [QUICK_START.md](./QUICK_START.md) for detailed steps.

## Folder Structure

```
Visual-Stitch/
├── output/
│   └── compilation.mp4        # Generated locally (not committed)
├── temp_processed/            # Temporary clips (gitignored)
├── temp_downloads/            # Downloaded from Google Photos (gitignored)
├── process-media-gcloud.py    # Main script (Google Photos version)
├── process-media.py           # Old script (local files - deprecated)
├── requirements.txt           # Python dependencies
├── client_secret.json         # OAuth credentials (gitignored)
├── token.json                 # Auth token (gitignored)
├── snapshots.html             # Web page
├── style.css                  # Styling
├── QUICK_START.md             # Quick setup guide
├── SETUP_GUIDE.md             # Detailed setup instructions
├── MIGRATION_SUMMARY.md       # Migration notes
└── test-local.sh              # Local testing helper
```

## Local Testing

```bash
cd Visual-Stitch
pip install -r requirements.txt

# Authenticate
python process-media-gcloud.py --auth-only

# List your albums
python process-media-gcloud.py --list-albums

# Process an album (no upload)
export GOOGLE_PHOTOS_ALBUM_ID="your-album-id"
python process-media-gcloud.py

# Process and upload to GCS
export GCS_BUCKET_NAME="your-bucket"
export GOOGLE_APPLICATION_CREDENTIALS="path/to/service-account.json"
python process-media-gcloud.py --upload-to-gcs

# Or use the helper script
bash test-local.sh
```

## GitHub Actions Workflow

The workflow runs automatically:
- **Every Monday at 00:00 UTC** (weekly schedule)
- **Manual trigger** via Actions tab

### What it does:
1. Authenticates with Google Photos
2. Downloads media from specified album
3. Processes and stitches video
4. Uploads to Google Cloud Storage
5. Your website loads the new video

### Monitor Progress
1. Go to GitHub repository → Actions tab
2. Select "Stitch Videos from Google Photos"
3. View recent runs and logs

## Album Management

### Monthly Albums

Create albums with this naming pattern:
- `Daily-Snapshots-2025-10` (October)
- `Daily-Snapshots-2025-11` (November)
- `Daily-Snapshots-2025-12` (December)

### Switch Months

1. Get new album ID: `python process-media-gcloud.py --list-albums`
2. Update GitHub Secret: `GOOGLE_PHOTOS_ALBUM_ID`
3. Trigger workflow manually or wait for Monday

### Multiple Compilations

Upload to different paths for different months:
```bash
python process-media-gcloud.py \
  --upload-to-gcs \
  --gcs-path "compilations/2025-10.mp4"
```

Then update your HTML to reference the specific compilation.

## Cost Estimate

### Google Cloud Storage

For a 100MB video with 100 monthly views:
- **Storage**: ~$0.0026/month
- **Bandwidth**: ~$1.20/month
- **Total**: ~$1.50/month

Tips to reduce costs:
1. Enable Cloud CDN (caching)
2. Use Nearline storage for old videos
3. Increase video compression

See [MIGRATION_SUMMARY.md](./MIGRATION_SUMMARY.md) for detailed cost breakdown.

## Benefits vs Old System

| Aspect | Old (Git) | New (Google Photos) |
|--------|-----------|---------------------|
| File Storage | In git repo | Google Photos |
| Video Hosting | Git (100MB limit) | GCS (unlimited) |
| Workflow | Download → commit → push | Automatic from Photos |
| Repo Size | Growing (100MB per video) | Small (code only) |
| Setup Complexity | Low | Medium (one-time) |
| Monthly Maintenance | Manual file management | 0 minutes |

## Troubleshooting

### "Invalid credentials" error
```bash
# Re-authenticate locally
python process-media-gcloud.py --auth-only

# Update GitHub secret with new token.json contents
```

### "Album not found"
```bash
# List all albums
python process-media-gcloud.py --list-albums

# Copy correct album ID to GitHub secret GOOGLE_PHOTOS_ALBUM_ID
```

### Video not showing on webpage
- Verify bucket name in [snapshots.html](./snapshots.html) line 23
- Check bucket is publicly readable
- Try direct URL: `https://storage.googleapis.com/YOUR-BUCKET/compilation.mp4`

### Videos in wrong order
- Check EXIF metadata has correct dates
- Files sorted by creation date, not filename
- Manually re-touch files if needed

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for more troubleshooting.

## Future Enhancements

- [ ] Multi-album support (combine all 2025 albums)
- [ ] Date overlays showing when clips were taken
- [ ] Month selector on webpage
- [ ] Webhook triggers (update when album changes)
- [ ] Fade transitions between clips
- [ ] Background music support
- [ ] Automatic monthly album creation

## Technical Details

### Technologies
- **Google Photos API**: Fetch media from albums
- **Google Cloud Storage**: Host compiled videos
- **FFmpeg**: Process and stitch videos
- **GitHub Actions**: Weekly automation
- **Python 3.11**: Orchestration

### Processing Pipeline
1. Authenticate with Google Photos API (OAuth 2.0)
2. Fetch media items from album
3. Download files temporarily
4. Convert images to video clips (with duration)
5. Standardize video formats (1920x1080, H.264)
6. Concatenate all clips
7. Upload to GCS with public access
8. Clean up temporary files

### Security
- OAuth tokens stored in GitHub Secrets
- Service account has minimal permissions
- No credentials committed to repository
- Temporary files cleaned after processing

## Documentation

- [QUICK_START.md](./QUICK_START.md) - Setup checklist
- [SETUP_GUIDE.md](./SETUP_GUIDE.md) - Detailed instructions
- [MIGRATION_SUMMARY.md](./MIGRATION_SUMMARY.md) - What changed and why
- [test-local.sh](./test-local.sh) - Local testing helper script

## Credits

Built with:
- **Python 3.11** for orchestration
- **FFmpeg** for video processing
- **Google Photos API** for media fetching
- **Google Cloud Storage** for video hosting
- **GitHub Actions** for automation
