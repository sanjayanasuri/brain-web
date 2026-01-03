# Brain Web macOS Launcher

This guide explains how to package and launch Brain Web as a native macOS application.

## Quick Start

### 1. Install as macOS App

Run the installer script:

```bash
./scripts/install_macos.sh
```

This will:
- Check all prerequisites (Docker, Python, Node.js)
- Create a macOS `.app` bundle
- Install it to your Applications folder
- Optionally create a desktop shortcut

### 2. Launch Brain Web

After installation, you can launch Brain Web in three ways:

1. **From Applications**: Open Applications folder → Double-click "Brain Web"
2. **From Spotlight**: Press `Cmd+Space`, type "Brain Web", press Enter
3. **From Terminal**: Run `./scripts/launch_brainweb.sh`

## What Gets Started

When you launch Brain Web, it automatically:

1. ✅ Checks Docker is running
2. ✅ Starts Neo4j database (via Docker)
3. ✅ Sets up Python backend environment
4. ✅ Starts FastAPI backend server (port 8000)
5. ✅ Sets up Node.js frontend environment
6. ✅ Starts Next.js frontend server (port 3000)
7. ✅ Opens your browser to http://localhost:3000
8. ✅ Monitors services and auto-restarts if they crash

## Manual Control

### Check Status

```bash
./scripts/status_brainweb.sh
```

### Stop All Services

```bash
./scripts/stop_brainweb.sh
```

### Start Services Manually

```bash
./scripts/launch_brainweb.sh
```

## File Locations

- **App Bundle**: `~/Applications/Brain Web.app`
- **PID Files**: `~/.brainweb/*.pid`
- **Logs**: `~/.brainweb/*.log`
- **Launcher Log**: `~/.brainweb/launcher.log`

## Troubleshooting

### Neo4j Desktop Not Running

If you see "Neo4j is not running":
1. Open Neo4j Desktop from Applications
2. Start your database (click the play button)
3. Make sure it's running on `bolt://localhost:7687`
4. Try launching Brain Web again

### Port Already in Use

If ports 3000 or 8000 are already in use:
1. Stop the conflicting service
2. Or modify the ports in:
   - Backend: `backend/main.py` (uvicorn port)
   - Frontend: `frontend/package.json` (dev script)

### Services Won't Start

Check the logs:
```bash
# Backend logs
tail -f ~/.brainweb/backend.log

# Frontend logs
tail -f ~/.brainweb/frontend.log

# Launcher log
tail -f ~/.brainweb/launcher.log
```

### First-Time Setup

Before first launch, make sure you have:

1. **Neo4j Desktop** installed and your database started
   - Download from: https://neo4j.com/download/
   - Create a database and start it
   - Default connection: `bolt://localhost:7687`
2. **Environment variables** configured in `.env.local`:
   ```bash
   NEO4J_URI=bolt://localhost:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your_password_here
   OPENAI_API_KEY=sk-... (optional)
   ```
3. **Neo4j Desktop** must be running with your database started

## Creating a Distribution Package

To create a distributable `.dmg` file:

1. Install the app using `install_macos.sh`
2. Use Disk Utility or `create-dmg` tool to create a disk image
3. Include the app bundle and a README

Example using `create-dmg`:
```bash
npm install -g create-dmg
create-dmg "Brain Web.app" ~/Desktop
```

## Advanced: Custom Icon

To add a custom app icon:

1. Create an `.icns` file (use `iconutil` or online converters)
2. Replace `Brain Web.app/Contents/Resources/icon.icns`
3. Rebuild the app bundle

## Uninstall

To remove Brain Web:

1. Quit the app (stop all services first)
2. Delete `~/Applications/Brain Web.app`
3. Optionally delete `~/.brainweb/` directory
4. Optionally stop and remove Neo4j: `docker compose down`

