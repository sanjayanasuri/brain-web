#!/usr/bin/env bash
# Add Brain Web to Dock for one-click access

APP_NAME="Brain Web"
APP_PATH="$HOME/Applications/$APP_NAME.app"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Brain Web app not found at $APP_PATH"
    echo "   Run: ./scripts/install_macos.sh first"
    exit 1
fi

echo "📌 Adding Brain Web to Dock..."
echo ""

# Create a Dock plist entry (macOS will handle this automatically when you drag)
echo "To add Brain Web to your Dock:"
echo ""
echo "1. Open Applications folder (Cmd+Shift+A in Finder)"
echo "2. Find 'Brain Web' app"
echo "3. Drag it to your Dock (anywhere on the left side)"
echo ""
echo "Or run this command to add it programmatically:"
echo ""
echo "defaults write com.apple.dock persistent-apps -array-add \"<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>$APP_PATH</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>\""
echo "killall Dock"
echo ""

read -p "Would you like me to add it to Dock automatically? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    defaults write com.apple.dock persistent-apps -array-add "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>$APP_PATH</string><key>_CFURLStringType</key><integer>0</integer></dict></dict></dict>"
    killall Dock
    echo "✅ Added to Dock! You should see it appear in a moment."
else
    echo "You can add it manually by dragging from Applications to Dock."
fi

