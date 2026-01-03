#!/usr/bin/env bash
# Create desktop shortcut for Brain Web

APP_NAME="Brain Web"
APP_PATH="$HOME/Applications/$APP_NAME.app"
DESKTOP_PATH="$HOME/Desktop/$APP_NAME.app"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Brain Web app not found at $APP_PATH"
    echo "   Run: ./scripts/install_macos.sh first"
    exit 1
fi

echo "📌 Creating desktop shortcut..."

# Remove existing shortcut if it exists
if [ -L "$DESKTOP_PATH" ] || [ -d "$DESKTOP_PATH" ]; then
    rm -rf "$DESKTOP_PATH"
    echo "   Removed existing shortcut"
fi

# Create symbolic link
ln -sf "$APP_PATH" "$DESKTOP_PATH"

if [ -L "$DESKTOP_PATH" ]; then
    echo "✅ Desktop shortcut created!"
    echo "   Location: $DESKTOP_PATH"
    echo ""
    echo "You can now double-click 'Brain Web' on your desktop to launch it."
else
    echo "❌ Failed to create shortcut"
    exit 1
fi

