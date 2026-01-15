#!/bin/bash

# Test script for local development
# This script helps you test the Google Photos integration locally

set -e

echo "=================================="
echo "Visual Stitch Local Test Script"
echo "=================================="
echo ""

# Check if running from correct directory
if [ ! -f "process-media-gcloud.py" ]; then
    echo "Error: Must run from Visaul-Stitch directory"
    exit 1
fi

# Check for required files
echo "Checking for required files..."
if [ ! -f "client_secret.json" ]; then
    echo "❌ Missing client_secret.json"
    echo "   Download from Google Cloud Console"
    exit 1
fi
echo "✓ Found client_secret.json"

# Check if authenticated
if [ ! -f "token.json" ]; then
    echo ""
    echo "⚠️  No authentication token found"
    echo "   Running authentication flow..."
    python process-media-gcloud.py --auth-only
    echo ""
fi

# Check for dependencies
echo ""
echo "Checking Python dependencies..."
if ! python -c "import google.auth" 2>/dev/null; then
    echo "⚠️  Missing dependencies. Installing..."
    pip install -r requirements.txt
fi
echo "✓ Dependencies installed"

# Check for ffmpeg
echo ""
echo "Checking for FFmpeg..."
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ FFmpeg not found"
    echo "   Install with: brew install ffmpeg (Mac) or apt install ffmpeg (Linux)"
    exit 1
fi
echo "✓ FFmpeg installed"

# List albums
echo ""
echo "=================================="
echo "Your Google Photos Albums:"
echo "=================================="
python process-media-gcloud.py --list-albums
echo ""

# Prompt for album ID
echo ""
read -p "Enter Album ID to process: " ALBUM_ID

if [ -z "$ALBUM_ID" ]; then
    echo "❌ No album ID provided"
    exit 1
fi

# Set environment variables
export GOOGLE_PHOTOS_ALBUM_ID="$ALBUM_ID"

# Ask about GCS upload
echo ""
read -p "Upload to Google Cloud Storage? (y/N): " UPLOAD_CHOICE

if [[ "$UPLOAD_CHOICE" =~ ^[Yy]$ ]]; then
    read -p "Enter GCS bucket name: " BUCKET_NAME
    read -p "Enter path to service account JSON: " SA_KEY_PATH

    if [ -z "$BUCKET_NAME" ] || [ -z "$SA_KEY_PATH" ]; then
        echo "❌ Bucket name or service account key missing"
        exit 1
    fi

    export GCS_BUCKET_NAME="$BUCKET_NAME"
    export GOOGLE_APPLICATION_CREDENTIALS="$SA_KEY_PATH"

    echo ""
    echo "=================================="
    echo "Processing and uploading..."
    echo "=================================="
    python process-media-gcloud.py --upload-to-gcs
else
    echo ""
    echo "=================================="
    echo "Processing (no upload)..."
    echo "=================================="
    python process-media-gcloud.py
fi

echo ""
echo "=================================="
echo "✓ Complete!"
echo "=================================="

if [ -f "output/compilation.mp4" ]; then
    echo ""
    echo "Video created: output/compilation.mp4"
    ls -lh output/compilation.mp4
    echo ""
    echo "To view: open output/compilation.mp4"
fi
