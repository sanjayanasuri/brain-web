#!/usr/bin/env python3
"""
Generate placeholder icons for the Brain Web extension.
Creates simple colored icons with a "BW" text overlay.
"""

from PIL import Image, ImageDraw, ImageFont
import os

def create_icon(size, output_path):
    """Create a simple icon with Brain Web branding."""
    # Create image with a gradient-like background
    img = Image.new('RGB', (size, size), color='#4A90E2')
    draw = ImageDraw.Draw(img)
    
    # Draw a simple circle/rounded square background
    margin = size // 8
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin],
        radius=size // 6,
        fill='#2C5F8D',
        outline='#1A3A5C',
        width=max(1, size // 32)
    )
    
    # Add "BW" text
    try:
        # Try to use a system font, fallback to default
        font_size = size // 2
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", font_size)
        except:
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
            except:
                font = ImageFont.load_default()
    except:
        font = ImageFont.load_default()
    
    text = "BW"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    position = ((size - text_width) // 2, (size - text_height) // 2 - bbox[1])
    draw.text(position, text, fill='#FFFFFF', font=font)
    
    img.save(output_path, 'PNG')
    print(f"Created {output_path} ({size}x{size})")

def main():
    assets_dir = os.path.join(os.path.dirname(__file__), '..', 'assets')
    os.makedirs(assets_dir, exist_ok=True)
    
    sizes = [16, 48, 128]
    for size in sizes:
        output_path = os.path.join(assets_dir, f'icon{size}.png')
        create_icon(size, output_path)
    
    print(f"\nIcons created in {assets_dir}")

if __name__ == '__main__':
    main()

