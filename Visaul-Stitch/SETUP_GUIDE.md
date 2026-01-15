# Google Photos API Setup Guide

This guide walks you through setting up Google Photos API integration for your Daily Snapshots compilation.

## Phase 1: Google Cloud Project Setup

### 1.1 Create/Select a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top
3. Click "New Project" or select an existing project
4. Name it something like "daily-snapshots" (if creating new)
5. Click "Create"

### 1.2 Enable Required APIs

1. In the Cloud Console, go to **APIs & Services > Library**
2. Search for and enable these APIs:
   - **Google Photos Library API**
   - **Google Cloud Storage API**
   - **Google Cloud Storage JSON API**

### 1.3 Create OAuth 2.0 Credentials

1. Go to **APIs & Services > Credentials**
2. Click **+ CREATE CREDENTIALS** > **OAuth client ID**
3. If prompted, configure the OAuth consent screen:
   - User Type: **External**
   - App name: "Daily Snapshots Compiler"
   - User support email: Your email
   - Developer contact: Your email
   - Scopes: Add `https://www.googleapis.com/auth/photoslibrary.readonly`
   - Test users: Add your Gmail address
   - Click **Save and Continue**
4. Back in Credentials, create OAuth client ID:
   - Application type: **Desktop app**
   - Name: "Daily Snapshots Desktop"
   - Click **Create**
5. **Download the JSON file** - save it as `client_secret.json` in the `Visaul-Stitch` folder
6. **IMPORTANT**: Add `client_secret.json` to `.gitignore` (we'll do this)

## Phase 2: Google Cloud Storage Setup

### 2.1 Create a Storage Bucket

1. Go to **Cloud Storage > Buckets**
2. Click **+ CREATE**
3. Bucket name: Choose a globally unique name like `emmet-daily-snapshots`
4. Region: Choose a location close to you (e.g., `us-west1`)
5. Storage class: **Standard**
6. Access control: **Uniform**
7. Click **Create**

### 2.2 Make Bucket Publicly Readable (for video hosting)

1. In the bucket details, go to the **Permissions** tab
2. Click **+ GRANT ACCESS**
3. New principals: `allUsers`
4. Role: **Storage Object Viewer**
5. Click **Save**
6. Confirm the public access warning

### 2.3 Create Service Account for GitHub Actions

1. Go to **IAM & Admin > Service Accounts**
2. Click **+ CREATE SERVICE ACCOUNT**
3. Name: `github-actions-uploader`
4. Description: "For uploading compilation videos from GitHub Actions"
5. Click **Create and Continue**
6. Grant roles:
   - **Storage Object Admin** (for the bucket)
7. Click **Continue** > **Done**
8. Click on the service account you just created
9. Go to **Keys** tab
10. Click **Add Key > Create new key**
11. Key type: **JSON**
12. Click **Create** - this downloads `github-actions-uploader-xxx.json`
13. **Save this file securely** - you'll add it to GitHub Secrets

## Phase 3: Google Photos Album Setup

### 3.1 Create Album

1. Go to [Google Photos](https://photos.google.com/)
2. Click **Albums** in the left sidebar
3. Click **+ Create album**
4. Name it: `Daily-Snapshots-2025-10` (for October 2025)
5. Add your October photos/videos to this album

### 3.2 Naming Convention for Files

To control how files appear in your compilation, use these naming patterns:

**For Images:**
- `IMG_123.jpg` - Uses default 3-second duration
- `IMG_123_5s.jpg` - Displays for 5 seconds
- `IMG_123_1s.jpg` - Displays for 1 second
- `_SKIP_IMG_123.jpg` - Excluded from compilation (starts with `_SKIP_`)

**For Videos:**
- `VID_456.mp4` - Uses full video duration
- `_SKIP_VID_456.mp4` - Excluded from compilation

**Note:** Google Photos may not preserve exact filenames when uploaded from phone. We'll handle this by:
- Using EXIF date metadata for ordering
- Supporting descriptions/captions for duration (e.g., "5s" in description)
- Manual filename editing in Google Photos web interface

## Phase 4: GitHub Secrets Setup

Add these secrets to your GitHub repository:

1. Go to your repo: **Settings > Secrets and variables > Actions**
2. Click **New repository secret** for each:

**Secret Name:** `GOOGLE_PHOTOS_CLIENT_SECRET`
**Value:** Entire contents of your `client_secret.json` file

**Secret Name:** `GCS_SERVICE_ACCOUNT_KEY`
**Value:** Entire contents of your service account JSON file

**Secret Name:** `GCS_BUCKET_NAME`
**Value:** Your bucket name (e.g., `emmet-daily-snapshots`)

**Secret Name:** `GOOGLE_PHOTOS_ALBUM_ID`
**Value:** We'll get this after running the script once (see Phase 5)

## Phase 5: Initial Authentication

The first time you run the script locally, you'll need to authenticate:

1. Install dependencies: `pip install -r requirements.txt`
2. Run: `python process-media.py --auth-only`
3. A browser window will open for Google OAuth
4. Sign in and grant permissions
5. A `token.json` file will be created
6. **Add token.json to GitHub Secrets** as `GOOGLE_PHOTOS_TOKEN`

## Phase 6: Find Album ID

After authentication, run:
```bash
python process-media.py --list-albums
```

This will show all your albums with their IDs. Copy the ID for `Daily-Snapshots-2025-10` and add it to GitHub Secrets as `GOOGLE_PHOTOS_ALBUM_ID`.

## Next Steps

Once all setup is complete:
1. The GitHub Action will run weekly (every Monday at 00:00 UTC)
2. It will fetch media from your Google Photos album
3. Process and compile the video
4. Upload to Google Cloud Storage
5. Your webpage will automatically show the latest version

## Troubleshooting

**"Access blocked" during OAuth:**
- Make sure you added yourself as a test user in OAuth consent screen
- The app is in testing mode, which is fine for personal use

**Videos not showing up:**
- Check if filenames start with `_SKIP_`
- Verify the album ID is correct
- Check GitHub Actions logs for errors

**Bucket not accessible:**
- Ensure `allUsers` has Storage Object Viewer role
- Check bucket is not using retention policies
