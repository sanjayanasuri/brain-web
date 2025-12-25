# Mobile Interface for Brain Web

This is a mobile-optimized Progressive Web App (PWA) interface for Brain Web, designed specifically for iOS and mobile devices.

## Features

- **Card-based concept list** - Easy to browse and tap
- **Quick add interface** - Add concepts via text or URLs
- **Search functionality** - Find concepts quickly
- **Bottom sheet details** - Tap any concept to see details
- **PWA support** - Install on iOS home screen

## How to Use

1. **Navigate to `/mobile`** on your device
2. **Add your first concept**:
   - Tap the "+" tab
   - Type a concept name (e.g., "Machine Learning")
   - Or paste a URL (e.g., "https://example.com")
   - Press Enter or tap "Add Concept"

3. **View concepts**:
   - Tap the "🧠" tab to see all your concepts
   - Tap any concept card to see details

4. **Search**:
   - Tap the "🔍" tab
   - Type to search your concepts

## Installing on iOS

1. Open Safari on your iPhone/iPad
2. Navigate to your Brain Web instance at `/mobile`
3. Tap the Share button
4. Tap "Add to Home Screen"
5. The app will appear as a native app icon

## Starting from Scratch

The mobile interface starts with an empty graph by default. All concepts you add will be created fresh. To load existing concepts, uncomment the code in `app/mobile/page.tsx` around line 30.

## Customization

- Icons: Add proper 192x192 and 512x512 PNG icons to `/public/`
- Colors: Update theme colors in `manifest.json` and `layout.tsx`
- Styling: All components use inline styles for easy customization

