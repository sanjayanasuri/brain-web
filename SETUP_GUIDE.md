# Brain Web - Setup Guide

## 🚀 Quick Setup (5 minutes)

### Prerequisites

Install these **once** on your Mac:

1. **Neo4j Desktop** (free)
   - Download: https://neo4j.com/download/
   - Install and open it
   - Create a database (any name, remember the password!)

2. **Node.js** (v18 or higher)
   - Download: https://nodejs.org/
   - Or install via Homebrew: `brew install node`

3. **Python 3** (v3.9 or higher)
   - Usually pre-installed on macOS
   - Check: `python3 --version`
   - If missing: `brew install python3`

### Step 1: Get the Code

```bash
# Clone the repository
git clone <your-repo-url>
cd brain-web
```

Or download and extract the ZIP file.

### Step 2: Configure Environment

Create `.env.local` in the project root:

```bash
# Copy the example file
cp backend/env.example .env.local

# Edit it with your Neo4j password
nano .env.local
```

**Minimum required settings:**
```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password_here  # ← Change this!
```

**Optional (for AI features):**
```bash
OPENAI_API_KEY=sk-...  # Get from https://platform.openai.com/api-keys
```

### Step 3: Install as macOS App

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Run the installer
./scripts/install_macos.sh
```

This will:
- ✅ Check prerequisites
- ✅ Create the macOS app
- ✅ Install to Applications folder
- ✅ Optionally create desktop shortcut

### Step 4: Launch Brain Web

**Before first launch:**
1. Open Neo4j Desktop
2. Start your database (click the play button)

**Then launch:**
- Double-click "Brain Web" from Applications or Desktop
- Or use Spotlight: `Cmd+Space` → type "Brain Web"

That's it! 🎉

---

## 📋 What Gets Installed

The installer creates:
- **App Bundle**: `~/Applications/Brain Web.app`
- **Desktop Shortcut**: `~/Desktop/Brain Web.app` (optional)
- **Logs**: `~/.brainweb/*.log`

---

## 🔧 Manual Setup (Alternative)

If you prefer to run manually without the app:

```bash
# 1. Start Neo4j Desktop and your database

# 2. Start backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000

# 3. Start frontend (new terminal)
cd frontend
npm install
npm run dev

# 4. Open browser
open http://localhost:3000
```

---

## ✅ Verification

After setup, verify everything works:

```bash
# Check status
./scripts/status_brainweb.sh

# Or manually check:
curl http://localhost:8000/  # Backend
curl http://localhost:3000/  # Frontend
```

---

## 🐛 Troubleshooting

### "Neo4j is not running"
→ Open Neo4j Desktop and start your database

### "npm not found"
→ Install Node.js from nodejs.org

### "Port already in use"
→ Stop the service using that port, or modify ports in config

### "Permission denied"
→ Run: `chmod +x scripts/*.sh`

### App won't launch
→ Check logs: `tail -f ~/.brainweb/launcher.log`

---

## 📦 Distribution

To share Brain Web with others:

1. **Option A: Share the repo**
   - They follow this guide
   - They run `./scripts/install_macos.sh`

2. **Option B: Create a DMG** (advanced)
   ```bash
   # After installation, create a disk image
   hdiutil create -volname "Brain Web" -srcfolder "Brain Web.app" -ov -format UDZO brain-web.dmg
   ```

3. **Option C: Package with dependencies** (most complex)
   - Bundle Node.js, Python, Neo4j Desktop installer
   - Create an installer script

---

## 🎯 Minimum Requirements Summary

**For end users:**
1. Install Neo4j Desktop
2. Install Node.js
3. Clone/download code
4. Create `.env.local` with Neo4j password
5. Run `./scripts/install_macos.sh`
6. Launch from Applications

**That's it!** Everything else is automated.

