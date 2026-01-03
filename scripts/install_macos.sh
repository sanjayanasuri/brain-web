#!/usr/bin/env bash
# Install Brain Web as a macOS application

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="Brain Web"
APP_DIR="$PROJECT_ROOT/$APP_NAME.app"
APPLICATIONS_DIR="$HOME/Applications"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Installing Brain Web for macOS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check Neo4j Desktop (optional check - just warn if not found)
echo -n "Neo4j Desktop: "
if [ -d "/Applications/Neo4j Desktop.app" ] || [ -d "$HOME/Applications/Neo4j Desktop.app" ]; then
    echo -e "${GREEN}✅ Installed${NC}"
else
    echo -e "${YELLOW}⚠️  Not found${NC}"
    echo "   You'll need Neo4j Desktop to run the database"
    echo "   Download from: https://neo4j.com/download/"
    echo "   (You can install it later)"
fi

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed"
    echo ""
    echo "Please install Python 3 from: https://www.python.org/downloads/"
    exit 1
fi
echo "   ✅ Python 3 installed"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo ""
    echo "Please install Node.js from: https://nodejs.org/"
    exit 1
fi
echo "   ✅ Node.js installed"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed"
    exit 1
fi
echo "   ✅ npm installed"

echo ""
echo "✅ All prerequisites met"
echo ""

# Create app bundle
echo "📦 Creating app bundle..."
"$SCRIPT_DIR/create_macos_app.sh"

# Copy to Applications
if [ -d "$APP_DIR" ]; then
    echo ""
    echo "📋 Installing to Applications folder..."
    
    # Remove existing app if it exists
    if [ -d "$APPLICATIONS_DIR/$APP_NAME.app" ]; then
        echo "   Removing existing installation..."
        rm -rf "$APPLICATIONS_DIR/$APP_NAME.app"
    fi
    
    # Copy app to Applications
    cp -R "$APP_DIR" "$APPLICATIONS_DIR/"
    
    echo "   ✅ Installed to: $APPLICATIONS_DIR/$APP_NAME.app"
    
    # Create desktop shortcut (optional)
    read -p "   Create desktop shortcut? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ln -sf "$APPLICATIONS_DIR/$APP_NAME.app" "$HOME/Desktop/$APP_NAME.app"
        echo "   ✅ Desktop shortcut created"
    fi
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "✅ Installation complete!"
    echo ""
    echo "🚀 To launch Brain Web:"
    echo "   • Open Applications folder"
    echo "   • Double-click '$APP_NAME'"
    echo "   • Or use Spotlight: Cmd+Space, type 'Brain Web'"
    echo ""
    echo "🛑 To stop Brain Web:"
    echo "   • Run: $SCRIPT_DIR/stop_brainweb.sh"
    echo "   • Or use Activity Monitor to quit the processes"
    echo ""
    echo "📝 First-time setup:"
    echo "   • Make sure Docker Desktop is running"
    echo "   • Configure .env.local with your Neo4j password and API keys"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Ask if user wants to launch now
    read -p "Launch Brain Web now? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "$APPLICATIONS_DIR/$APP_NAME.app"
    fi
else
    echo "❌ Failed to create app bundle"
    exit 1
fi

