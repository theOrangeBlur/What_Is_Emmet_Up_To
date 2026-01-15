# Migration Summary: Git Storage → Google Photos + Cloud Storage

## What Changed?

### Before
- Media files stored in `Visaul-Stitch/media/` folders in git
- Compiled video (`compilation.mp4`) committed to git (~100MB)
- Hit GitHub's 50MB file size warning
- Required downloading files to local machine, then pushing to git

### After
- Media files stay in Google Photos (single source of truth)
- Compiled video hosted on Google Cloud Storage
- No large files in git repository
- Direct integration with Google Photos API

## New Architecture

```
Google Photos Album
    ↓
GitHub Actions (weekly)
    ↓
Download → Process → Stitch → Upload
    ↓
Google Cloud Storage (public URL)
    ↓
Your Webpage (loads video from GCS)
```

## Key Features

### 1. Filename Control
- **Duration**: `photo_5s.jpg` → 5 seconds in video
- **Exclusion**: `_SKIP_photo.jpg` → Not included in compilation
- **Default**: `photo.jpg` → 3 seconds (images), full duration (videos)

### 2. Automatic Ordering
- Files sorted by EXIF creation date (chronological)
- No need to rename files with dates

### 3. Weekly Updates
- Runs every Monday at 00:00 UTC
- Can also trigger manually via GitHub Actions

### 4. Cost Efficient
- Google Photos: Already paying for storage
- Google Cloud Storage: ~$0.026/GB/month
- Example: 100MB video = $0.26/year storage

## Files Created

| File | Purpose |
|------|---------|
| `process-media-gcloud.py` | Main script with Google Photos API |
| `requirements.txt` | Python dependencies |
| `SETUP_GUIDE.md` | Detailed setup instructions |
| `QUICK_START.md` | Quick reference checklist |
| `test-local.sh` | Local testing helper script |
| `.github/workflows/stitch-video-gcloud.yml` | New GitHub Actions workflow |

## Files Modified

| File | Changes |
|------|---------|
| `snapshots.html` | Video source points to GCS URL |
| `.gitignore` | Added credentials, temp files, output video |

## Files You Can Delete (After Testing)

Once the new system works:

- `.github/workflows/stitch-video.yml` (old workflow)
- `Visaul-Stitch/media/**/*` (media files now in Google Photos)
- `process-media.py` (replaced by `process-media-gcloud.py`)

## What You Need to Do

### Setup Phase (1 hour)
1. Follow [SETUP_GUIDE.md](./SETUP_GUIDE.md) to configure Google Cloud
2. Create OAuth credentials and service account
3. Set up GCS bucket
4. Add secrets to GitHub
5. Update HTML with your bucket name

### Regular Usage
1. Add photos/videos to `Daily-Snapshots-2025-10` album in Google Photos
2. Use filename conventions (`_5s`, `_SKIP_`) to control compilation
3. Wait for Monday (automatic) or trigger manually
4. Video updates automatically on your website

## Benefits

### 1. No Git Bloat
- Repository stays small
- No 100MB video files
- Faster clone/pull operations

### 2. Single Source of Truth
- Media files only in Google Photos
- No sync between local/git/photos
- Easier to manage

### 3. Scalability
- Can handle videos of any size
- GCS designed for large file hosting
- CDN-backed delivery (fast worldwide)

### 4. Flexibility
- Easy to change which album to compile
- Can create monthly compilations
- Test locally before deploying

### 5. Security
- Credentials stored as GitHub Secrets
- Service account has limited permissions
- No sensitive data in repository

## Monthly Workflow

When you want to create November's compilation:

1. Create new album: `Daily-Snapshots-2025-11`
2. Add November photos/videos
3. Get album ID: `python process-media-gcloud.py --list-albums`
4. Update GitHub Secret: `GOOGLE_PHOTOS_ALBUM_ID`
5. Trigger workflow manually or wait for Monday

Optional: Create different GCS paths for each month:
- `compilations/2025-10.mp4`
- `compilations/2025-11.mp4`
- `compilations/2025-12.mp4`

## Troubleshooting

See [QUICK_START.md](./QUICK_START.md) for common issues and solutions.

## Cost Estimate

### Google Cloud Storage Costs
Based on US-WEST region, Standard storage:

| Scenario | Monthly Cost |
|----------|--------------|
| 100MB video, 100 views | ~$1.50 |
| 500MB video, 100 views | ~$6.00 |
| 100MB video, 1000 views | ~$12.00 |

**Breakdown:**
- Storage: $0.026/GB/month (negligible for one video)
- Bandwidth: $0.12/GB after first 1GB free

**To reduce costs:**
1. Enable Cloud CDN (caching)
2. Use Nearline storage for old videos ($0.01/GB/month)
3. Compress videos more aggressively (lower bitrate)

## Next Enhancements

Ideas for future improvements:

### Album Management
- Combine multiple albums (all of 2025)
- Auto-detect new month albums
- Support album naming patterns

### Video Features
- Add date overlays to clips
- Background music
- Transitions between clips
- Title cards for months

### Webpage Enhancements
- Month selector dropdown
- Video duration/clip count display
- Thumbnail gallery
- Download option

### Automation
- Webhook triggers (update when album changes)
- Telegram/Discord notifications when video updates
- Automatic monthly album creation

## Questions?

1. Check [QUICK_START.md](./QUICK_START.md) for setup help
2. See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed steps
3. Test locally with `bash test-local.sh`
4. Check GitHub Actions logs for workflow issues

---

**Status**: Ready to deploy
**Estimated Setup Time**: 1 hour
**Estimated Monthly Cost**: $1-5 (depending on traffic)
**Maintenance**: ~5 minutes/month (creating new albums)
