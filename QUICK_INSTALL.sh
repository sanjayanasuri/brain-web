#!/usr/bin/env bash
# Quick Install Script - Brain Web
# This is the absolute minimum setup script

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Brain Web - Quick Install"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if we're in the right directory
if [ ! -f "scripts/install_macos.sh" ]; then
    echo "❌ Error: Please run this script from the brain-web project root"
    echo "   cd brain-web"
    echo "   ./QUICK_INSTALL.sh"
    exit 1
fi

# Check prerequisites
echo "🔍 Checking prerequisites..."
echo ""

MISSING=0

# Check Neo4j Desktop
if [ -d "/Applications/Neo4j Desktop.app" ] || [ -d "$HOME/Applications/Neo4j Desktop.app" ]; then
    echo "   ✅ Neo4j Desktop installed"
else
    echo "   ❌ Neo4j Desktop not found"
    echo "      Download from: https://neo4j.com/download/"
    MISSING=1
fi

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 18 ]; then
        echo "   ✅ Node.js installed ($(node --version))"
    else
        echo "   ⚠️  Node.js version too old ($(node --version))"
        echo "      Need v18 or higher. Download from: https://nodejs.org/"
        MISSING=1
    fi
else
    echo "   ❌ Node.js not found"
    echo "      Download from: https://nodejs.org/"
    MISSING=1
fi

# Check Python
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2 | cut -d'.' -f1,2)
    echo "   ✅ Python 3 installed ($(python3 --version))"
else
    echo "   ❌ Python 3 not found"
    echo "      Install: brew install python3"
    MISSING=1
fi

echo ""

if [ $MISSING -eq 1 ]; then
    echo "⚠️  Some prerequisites are missing. Please install them first."
    echo ""
    echo "After installing, run this script again:"
    echo "   ./QUICK_INSTALL.sh"
    exit 1
fi

# Check .env.local
if [ ! -f ".env.local" ]; then
    echo "📝 Creating .env.local..."
    echo ""
    echo "Please enter your Neo4j password:"
    read -s NEO4J_PASS
    echo ""
    
    cat > .env.local <<EOF
# Neo4j Configuration
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=$NEO4J_PASS

# Optional: OpenAI API Key (for AI features)
# OPENAI_API_KEY=sk-...
EOF
    
    echo "✅ Created .env.local"
    echo ""
else
    echo "✅ .env.local already exists"
    echo ""
fi

# Make scripts executable
echo "🔧 Setting up scripts..."
chmod +x scripts/*.sh
echo "   ✅ Scripts are executable"
echo ""

# Run the installer
echo "📦 Running installer..."
echo ""
./scripts/install_macos.sh

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Setup Complete!"
echo ""
echo "📋 Final Steps:"
echo ""
echo "1. Open Neo4j Desktop"
echo "2. Start your database (click play button)"
echo "3. Launch Brain Web from Applications"
echo ""
echo "🎉 You're all set!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

