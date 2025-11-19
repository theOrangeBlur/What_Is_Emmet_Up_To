import os
from pathlib import Path
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
import subprocess
import json

class MediaStitcher:
    def __init__(self, input_folder, output_file="output.mp4", fps=30):
        self.input_folder = Path(input_folder)
        self.output_file = output_file
        self.fps = fps
        self.temp_folder = Path("temp_processed")
        self.temp_folder.mkdir(exist_ok=True)
        
    def get_media_files(self):
        """Get all image and video files, sorted by date"""
        extensions = {'.jpg', '.jpeg', '.png', '.mp4', '.mov', '.avi', '.gif'}
        files = [f for f in self.input_folder.iterdir() 
                if f.suffix.lower() in extensions]
        
        # Sort by creation/modification time
        files.sort(key=lambda x: x.stat().st_mtime)
        return files
    
    def get_file_date(self, filepath):
        """Extract date from file metadata"""
        try:
            # Try to get creation time
            timestamp = filepath.stat().st_mtime
            return datetime.fromtimestamp(timestamp)
        except:
            return datetime.now()
    
    def add_date_to_image(self, img_path, output_path, date_str, duration=3):
        """Add date overlay to image and save as temporary file"""
        img = Image.open(img_path)
        
        # Resize to standard resolution (1920x1080)
        img = img.resize((1920, 1080), Image.Resampling.LANCZOS)
        
        # Create drawing context
        draw = ImageDraw.Draw(img)
        
        # Try to use a nice font, fall back to default if not available
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)
        except:
            font = ImageFont.load_default()
        
        # Add semi-transparent background for text
        text_bbox = draw.textbbox((0, 0), date_str, font=font)
        text_width = text_bbox[2] - text_bbox[0]
        text_height = text_bbox[3] - text_bbox[1]
        
        padding = 20
        box_position = (20, 1080 - text_height - 40)
        draw.rectangle(
            [box_position[0] - padding, box_position[1] - padding,
             box_position[0] + text_width + padding, box_position[1] + text_height + padding],
            fill=(0, 0, 0, 180)
        )
        
        # Draw date text
        draw.text(box_position, date_str, fill=(255, 255, 255), font=font)
        
        img.save(output_path)
        return duration
    
    def create_video_list(self, media_files):
        """Process all media and create FFmpeg concat file"""
        concat_file = self.temp_folder / "concat_list.txt"
        
        with open(concat_file, 'w') as f:
            for i, media_file in enumerate(media_files):
                date = self.get_file_date(media_file)
                date_str = date.strftime("%B %d, %Y")
                
                if media_file.suffix.lower() in {'.jpg', '.jpeg', '.png', '.gif'}:
                    # Process image
                    temp_img = self.temp_folder / f"img_{i:04d}.png"
                    duration = self.add_date_to_image(media_file, temp_img, date_str)
                    
                    # Convert image to video segment
                    temp_video = self.temp_folder / f"vid_{i:04d}.mp4"
                    cmd = [
                        'ffmpeg', '-loop', '1', '-i', str(temp_img),
                        '-c:v', 'libx264', '-t', str(duration),
                        '-pix_fmt', 'yuv420p', '-vf', f'fps={self.fps}',
                        '-y', str(temp_video)
                    ]
                    subprocess.run(cmd, capture_output=True)
                    f.write(f"file '{temp_video.absolute()}'\n")
                    
                else:
                    # For videos, add date overlay directly
                    temp_video = self.temp_folder / f"vid_{i:04d}.mp4"
                    cmd = [
                        'ffmpeg', '-i', str(media_file),
                        '-vf', f"scale=1920:1080:force_original_aspect_ratio=decrease,"
                               f"pad=1920:1080:-1:-1:color=black,"
                               f"drawtext=text='{date_str}':fontsize=48:fontcolor=white:"
                               f"box=1:boxcolor=black@0.7:boxborderw=20:x=20:y=h-th-40",
                        '-c:v', 'libx264', '-c:a', 'aac', '-y', str(temp_video)
                    ]
                    subprocess.run(cmd, capture_output=True)
                    f.write(f"file '{temp_video.absolute()}'\n")
                
                print(f"Processed {i+1}/{len(media_files)}: {media_file.name}")
        
        return concat_file
    
    def stitch_videos(self, concat_file):
        """Combine all video segments into final output"""
        cmd = [
            'ffmpeg', '-f', 'concat', '-safe', '0',
            '-i', str(concat_file),
            '-c', 'copy', '-y', self.output_file
        ]
        subprocess.run(cmd, capture_output=True)
        print(f"\n✓ Video created: {self.output_file}")
    
    def cleanup(self):
        """Remove temporary files"""
        import shutil
        shutil.rmtree(self.temp_folder)
        print("✓ Cleaned up temporary files")
    
    def create_movie(self):
        """Main workflow"""
        print("Starting media stitcher...\n")
        
        media_files = self.get_media_files()
        print(f"Found {len(media_files)} media files\n")
        
        concat_file = self.create_video_list(media_files)
        self.stitch_videos(concat_file)
        self.cleanup()
        
        print("\n✓ Done!")

# Usage
if __name__ == "__main__":
    stitcher = MediaStitcher(
        input_folder="C:/Users/eckma/OneDrive/Documents/Website/Visaul-Stitch/media",  # Change to your folder path
        output_file="my_life_movie.mp4",
        fps=30
    )
    stitcher.create_movie()