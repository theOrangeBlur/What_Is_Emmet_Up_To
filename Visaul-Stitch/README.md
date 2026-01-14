# Visual Stitch - Automated Video Compilation

An automated system that stitches photos and videos into one compilation video, updating automatically via GitHub Actions when new media is added.

## How It Works

1. **Add Media**: Drop photos/videos into monthly folders (`media/2025-01/`, `media/2025-02/`, etc.)
2. **Name Files**: For images, add `_Xs` suffix to specify duration (e.g., `sunset_5s.jpg` = 5 seconds)
3. **Push to GitHub**: Commit and push your changes
4. **Automatic Processing**: GitHub Actions automatically runs the processing script
5. **Video Updates**: The compilation video is generated and committed back to the repo

## File Naming Convention

### Images
- With duration: `filename_5s.jpg` (displays for 5 seconds)
- Without duration: `filename.jpg` (defaults to 3 seconds)
- Supported formats: `.jpg`, `.jpeg`, `.png`

### Videos
- Standard naming: `filename.mp4`
- Uses natural video duration
- Supported formats: `.mp4`, `.mov`, `.avi`, `.mkv`

## Folder Structure

```
Visaul-Stitch/
├── media/                  # Organized by month
│   ├── 2025-01/
│   ├── 2025-02/
│   └── ...
├── output/
│   └── compilation.mp4     # Generated video (tracked in git)
├── temp_processed/         # Temporary processing files (gitignored)
├── process-media.py        # Processing script
├── snapshots.html          # Web page
└── style.css               # Styling
```

## Local Testing (Optional)

If you want to test the processing locally before pushing to GitHub:

### Prerequisites
1. Install Python 3.x: https://www.python.org/downloads/
2. Install FFmpeg: https://ffmpeg.org/download.html
   - Windows: Use Chocolatey `choco install ffmpeg` or download binaries
   - Mac: Use Homebrew `brew install ffmpeg`
   - Linux: `sudo apt-get install ffmpeg`

### Run Locally
```bash
cd Visaul-Stitch
python process-media.py
```

The script will:
1. Scan all monthly media folders
2. Process images and videos
3. Generate `output/compilation.mp4`

### Check Output
Open `output/compilation.mp4` in a video player to verify the compilation.

## GitHub Actions Deployment

The system uses GitHub Actions for automated processing:

### Workflow Trigger
- Automatically runs when you push changes to `Visaul-Stitch/media/**`
- Can also be triggered manually from the Actions tab

### Workflow Steps
1. Checkout repository
2. Install Python and FFmpeg
3. Run `process-media.py`
4. Commit and push the generated video

### Monitor Progress
1. Go to your GitHub repository
2. Click the "Actions" tab
3. View the "Stitch Videos" workflow runs
4. Check logs if something goes wrong

## Adding New Media

### Quick Steps
1. Create or navigate to the appropriate monthly folder:
   ```bash
   mkdir -p Visaul-Stitch/media/2025-01
   cd Visaul-Stitch/media/2025-01
   ```

2. Copy your media files:
   - Rename images with duration if needed: `photo_5s.jpg`
   - Videos can keep their original names

3. Commit and push:
   ```bash
   git add Visaul-Stitch/media/
   git commit -m "Add new snapshots for January 2025"
   git push
   ```

4. Wait for GitHub Actions to process (usually 2-5 minutes)

5. Visit your website to see the updated compilation

## File Size Considerations

GitHub has a 100MB file size limit per file. The processing script compresses videos using:
- `-crf 23` (Constant Rate Factor, good quality compression)
- 1920x1080 max resolution
- AAC audio at 128kbps

If your compilation exceeds 100MB:
- Consider hosting the video externally (YouTube, Vimeo, etc.)
- Create monthly compilations instead of one master video
- Increase compression (higher `-crf` value in the script)

## Troubleshooting

### Video not updating after push
- Check the Actions tab for workflow errors
- Ensure file paths are correct in commit
- Verify FFmpeg installed successfully in workflow

### Video won't play on website
- Check browser console for errors
- Verify `output/compilation.mp4` exists in repository
- Try clearing browser cache
- Check file path in `snapshots.html`

### Processing takes too long
- GitHub Actions has a 6-hour timeout (should be plenty)
- For very large media collections, consider splitting by month

### Image not displaying for correct duration
- Verify filename format: `name_5s.jpg` (underscore, number, 's', extension)
- Check Python script logs for parsing errors

## Future Enhancements

- [ ] Add date overlays showing when each clip was taken
- [ ] Create monthly compilation views
- [ ] Add playback speed controls
- [ ] Display total duration and clip count
- [ ] Support for GIF files
- [ ] Fade transitions between clips
- [ ] Background music support

## Technical Details

### Image Processing
Images are converted to video clips using FFmpeg:
```bash
ffmpeg -loop 1 -i image.jpg -t 5 -c:v libx264 -pix_fmt yuv420p output.mp4
```

### Video Standardization
Videos are re-encoded for consistency:
```bash
ffmpeg -i input.mp4 -c:v libx264 -crf 23 -c:a aac output.mp4
```

### Concatenation
All clips are concatenated using FFmpeg's concat demuxer with a file list.

## Credits

Built with:
- **Python 3** for orchestration
- **FFmpeg** for video processing
- **GitHub Actions** for automation
- **GitHub Pages** for hosting
