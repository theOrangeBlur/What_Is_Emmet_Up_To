# Quick Start Guide

## What Just Changed?

Your Daily Snapshots system now pulls media directly from Google Photos instead of storing files in git. The compilation video is hosted on Google Cloud Storage instead of being committed to your repository.

## Files Created

1. **[SETUP_GUIDE.md](./SETUP_GUIDE.md)** - Complete setup instructions
2. **[process-media-gcloud.py](./process-media-gcloud.py)** - New Python script with Google Photos integration
3. **[requirements.txt](./requirements.txt)** - Python dependencies
4. **[.github/workflows/stitch-video-gcloud.yml](../.github/workflows/stitch-video-gcloud.yml)** - Updated GitHub Actions workflow

## Setup Checklist

Follow these steps in order:

### 1. Google Cloud Setup (30 minutes)
- [ ] Create/select Google Cloud project
- [ ] Enable Google Photos Library API
- [ ] Enable Google Cloud Storage API
- [ ] Create OAuth 2.0 credentials → download `client_secret.json`
- [ ] Create GCS bucket (e.g., `emmet-daily-snapshots`)
- [ ] Make bucket publicly readable
- [ ] Create service account for GitHub Actions → download JSON key

### 2. Google Photos Setup (5 minutes)
- [ ] Create album: `Daily-Snapshots-2025-10`
- [ ] Add your October 2024 photos/videos to the album
- [ ] Rename files to control behavior:
  - Add `_5s` suffix for 5-second image duration
  - Add `_SKIP_` prefix to exclude from compilation

### 3. Local Authentication (5 minutes)
```bash
cd Visaul-Stitch
pip install -r requirements.txt
python process-media-gcloud.py --auth-only
```
This opens your browser for Google OAuth. After authenticating, a `token.json` file is created.

### 4. Get Album ID (2 minutes)
```bash
python process-media-gcloud.py --list-albums
```
Copy the ID for `Daily-Snapshots-2025-10`.

### 5. GitHub Secrets Setup (10 minutes)

Go to your repo → Settings → Secrets and variables → Actions

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `GOOGLE_PHOTOS_CLIENT_SECRET` | Contents of `client_secret.json` |
| `GOOGLE_PHOTOS_TOKEN` | Contents of `token.json` |
| `GOOGLE_PHOTOS_ALBUM_ID` | Album ID from step 4 |
| `GCS_BUCKET_NAME` | Your bucket name (e.g., `emmet-daily-snapshots`) |
| `GCS_SERVICE_ACCOUNT_KEY` | Contents of service account JSON key |

### 6. Update HTML (2 minutes)

Edit [snapshots.html](./snapshots.html) line 23:

Replace `YOUR-BUCKET-NAME` with your actual bucket name.

```html
<source src="https://storage.googleapis.com/emmet-daily-snapshots/compilation.mp4" type="video/mp4">
```

### 7. Test Locally (5 minutes)

Test the full pipeline locally:

```bash
# Set environment variables
export GOOGLE_PHOTOS_ALBUM_ID="your-album-id"
export GCS_BUCKET_NAME="your-bucket-name"
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"

# Run the script
python process-media-gcloud.py --upload-to-gcs
```

### 8. Test GitHub Actions (5 minutes)

- Go to Actions tab in your GitHub repo
- Select "Stitch Videos from Google Photos" workflow
- Click "Run workflow"
- Watch it process!

## Naming Conventions

Control video behavior with filenames:

### Images
- `photo.jpg` → 3 seconds (default)
- `photo_5s.jpg` → 5 seconds
- `photo_1s.jpg` → 1 second
- `_SKIP_photo.jpg` → Excluded

### Videos
- `video.mp4` → Full duration
- `_SKIP_video.mp4` → Excluded

## Workflow Schedule

The GitHub Action runs:
- **Every Monday at 00:00 UTC** (automatic)
- **Manual trigger** via Actions tab → Run workflow

## Costs

With your Google Cloud account:

### Google Cloud Storage
- **Storage**: ~$0.026/GB/month for Standard class
- **Bandwidth**: First 1GB/month free, then ~$0.12/GB
- **100MB video example**:
  - Storage: $0.0026/month
  - Bandwidth (100 views): $1.20/month

### Recommendation
If you get high traffic, consider:
1. Enabling Cloud CDN (caching reduces bandwidth)
2. Using Nearline storage class for older videos ($0.01/GB/month)

## Troubleshooting

### "Invalid credentials" error
- Regenerate `token.json`: `python process-media-gcloud.py --auth-only`
- Update `GOOGLE_PHOTOS_TOKEN` secret in GitHub

### "Album not found"
- Verify album ID: `python process-media-gcloud.py --list-albums`
- Update `GOOGLE_PHOTOS_ALBUM_ID` secret

### "Permission denied" on GCS upload
- Check service account has "Storage Object Admin" role
- Verify `GOOGLE_APPLICATION_CREDENTIALS` points to correct JSON file

### Video not showing on webpage
- Check bucket is publicly readable
- Verify URL in HTML matches your bucket name
- Try direct URL in browser: `https://storage.googleapis.com/YOUR-BUCKET/compilation.mp4`

## Next Steps

Once everything works:

1. **Remove old workflow**: Delete `.github/workflows/stitch-video.yml`
2. **Remove local media**: Delete files in `Visaul-Stitch/media/` (they're in Google Photos now)
3. **Create more albums**: For November, create `Daily-Snapshots-2025-11`
4. **Update workflow**: Change `GOOGLE_PHOTOS_ALBUM_ID` to compile different months

## Monthly Album Updates

To compile a different month:

1. Create new album in Google Photos (e.g., `Daily-Snapshots-2025-11`)
2. Get its album ID: `python process-media-gcloud.py --list-albums`
3. Update GitHub Secret: `GOOGLE_PHOTOS_ALBUM_ID`
4. Manual trigger or wait for weekly run

## Questions?

Check the full [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed instructions.
