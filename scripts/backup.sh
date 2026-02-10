#!/bin/bash
#
# Brain Web Backup Script
# Backs up Neo4j, PostgreSQL, Qdrant, and configuration
#
# Usage: ./backup.sh [backup_dir]
# Example: ./backup.sh ~/backups

set -e

BACKUP_DIR=${1:-~/backups}
DATE=$(date +%Y%m%d_%H%M%S)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "Brain Web Backup"
echo "Date: $(date)"
echo "=========================================="
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "Backup directory: $BACKUP_DIR"
echo ""

# Check if services are running
if ! docker compose -f "$PROJECT_DIR/docker-compose.yml" ps | grep -q "Up"; then
    echo "WARNING: Some services may not be running"
    echo "Continuing with backup anyway..."
    echo ""
fi

# Backup Neo4j
echo "Step 1: Backing up Neo4j..."
if docker ps | grep -q brainweb-neo4j; then
    docker exec brainweb-neo4j neo4j-admin database dump neo4j --to-path=/tmp 2>/dev/null || true
    docker cp brainweb-neo4j:/tmp/neo4j.dump "$BACKUP_DIR/neo4j_$DATE.dump" 2>/dev/null || echo "  Warning: Neo4j backup may have failed"
    echo "✓ Neo4j backup: neo4j_$DATE.dump"
else
    echo "  Skipping: Neo4j container not running"
fi
echo ""

# Backup PostgreSQL
echo "Step 2: Backing up PostgreSQL..."
if docker ps | grep -q brainweb-postgres; then
    docker exec brainweb-postgres pg_dump -U brainweb brainweb > "$BACKUP_DIR/postgres_$DATE.sql" 2>/dev/null || echo "  Warning: PostgreSQL backup may have failed"
    echo "✓ PostgreSQL backup: postgres_$DATE.sql"
else
    echo "  Skipping: PostgreSQL container not running"
fi
echo ""

# Backup Qdrant
echo "Step 3: Backing up Qdrant..."
if docker ps | grep -q brainweb-qdrant; then
    docker exec brainweb-qdrant tar czf /tmp/qdrant.tar.gz /qdrant/storage 2>/dev/null || true
    docker cp brainweb-qdrant:/tmp/qdrant.tar.gz "$BACKUP_DIR/qdrant_$DATE.tar.gz" 2>/dev/null || echo "  Warning: Qdrant backup may have failed"
    echo "✓ Qdrant backup: qdrant_$DATE.tar.gz"
else
    echo "  Skipping: Qdrant container not running"
fi
echo ""

# Backup Redis (optional)
echo "Step 4: Backing up Redis..."
if docker ps | grep -q brainweb-redis; then
    docker exec brainweb-redis redis-cli SAVE > /dev/null 2>&1 || true
    docker cp brainweb-redis:/data/dump.rdb "$BACKUP_DIR/redis_$DATE.rdb" 2>/dev/null || echo "  Warning: Redis backup may have failed"
    echo "✓ Redis backup: redis_$DATE.rdb"
else
    echo "  Skipping: Redis container not running"
fi
echo ""

# Backup environment file
echo "Step 5: Backing up configuration..."
if [ -f "$PROJECT_DIR/.env" ]; then
    cp "$PROJECT_DIR/.env" "$BACKUP_DIR/env_$DATE.txt"
    echo "✓ Environment backup: env_$DATE.txt"
else
    echo "  Warning: .env file not found"
fi
echo ""

# Create backup manifest
echo "Step 6: Creating backup manifest..."
cat > "$BACKUP_DIR/manifest_$DATE.txt" <<EOF
Brain Web Backup Manifest
Date: $(date)
Hostname: $(hostname)

Files:
$(ls -lh "$BACKUP_DIR"/*_$DATE.* 2>/dev/null || echo "No backup files found")

Docker Containers:
$(docker compose -f "$PROJECT_DIR/docker-compose.yml" ps 2>/dev/null || echo "Could not list containers")
EOF
echo "✓ Manifest created: manifest_$DATE.txt"
echo ""

# Calculate backup size
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)

# Clean up old backups (keep last 7 days)
echo "Step 7: Cleaning up old backups (keeping last 7 days)..."
find "$BACKUP_DIR" -type f -mtime +7 -delete 2>/dev/null || true
echo "✓ Cleanup complete"
echo ""

echo "=========================================="
echo "Backup Complete!"
echo "=========================================="
echo ""
echo "Backup location: $BACKUP_DIR"
echo "Backup size: $BACKUP_SIZE"
echo "Backup files:"
ls -lh "$BACKUP_DIR"/*_$DATE.* 2>/dev/null || echo "No backup files created"
echo ""
echo "To restore from backup, see HETZNER_SETUP.md"
echo ""
