#!/usr/bin/env bash
# Create macOS .app bundle for Brain Web

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="Brain Web"
APP_DIR="$PROJECT_ROOT/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

echo "📦 Creating macOS app bundle..."
echo ""

# Remove existing app if it exists
if [ -d "$APP_DIR" ]; then
    echo "   Removing existing app bundle..."
    rm -rf "$APP_DIR"
fi

# Create directory structure
mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"

# Create Info.plist
cat > "$CONTENTS_DIR/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>BrainWeb</string>
    <key>CFBundleIdentifier</key>
    <string>com.brainweb.app</string>
    <key>CFBundleName</key>
    <string>Brain Web</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSUIElement</key>
    <false/>
</dict>
</plist>
EOF

# Create the executable script with the actual project path embedded
# Escape single quotes for AppleScript
ESCAPED_PROJECT_ROOT=$(printf '%s' "$PROJECT_ROOT" | sed "s/'/'\"'\"'/g")

cat > "$MACOS_DIR/BrainWeb" <<EXEC_SCRIPT
#!/usr/bin/env bash
# Brain Web App Executable

# Project root is embedded at app creation time
PROJECT_ROOT="$PROJECT_ROOT"

# Open Terminal window and run the launcher script
# This ensures the user can see output and the script runs properly
osascript <<APPLESCRIPT
tell application "Terminal"
    activate
    do script "cd '$ESCAPED_PROJECT_ROOT' && '$ESCAPED_PROJECT_ROOT/scripts/launch_brainweb.sh'"
end tell
APPLESCRIPT
EXEC_SCRIPT

chmod +x "$MACOS_DIR/BrainWeb"

# Create app icon (placeholder - you can replace this with a real icon)
# For now, we'll create a simple text file that can be replaced later
echo "Icon placeholder - replace with .icns file" > "$RESOURCES_DIR/icon.icns"

echo "✅ App bundle created at: $APP_DIR"
echo ""
echo "To install:"
echo "  1. Drag '$APP_NAME.app' to your Applications folder"
echo "  2. Right-click and select 'Open' (first time only)"
echo "  3. Double-click to launch Brain Web"
echo ""
echo "Or run: open '$APP_DIR'"

