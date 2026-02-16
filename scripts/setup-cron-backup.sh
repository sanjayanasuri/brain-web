#!/bin/bash

# Brain Web - Automated Backup Setup
# Creates a cron job for daily database backups

set -e

BACKUP_SCRIPT="/root/brain-web/scripts/backup.sh"
CRON_TIME="0 2 * * *"  # 2 AM UTC daily

echo "=========================================="
echo "Brain Web - Backup Automation Setup"
echo "=========================================="

# Step 1: Make backup script executable
echo ""
echo "Step 1: Making backup script executable..."
chmod +x "$BACKUP_SCRIPT"

# Step 2: Create cron job
echo ""
echo "Step 2: Setting up cron job..."

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "$BACKUP_SCRIPT"; then
    echo "⚠️  Cron job already exists. Skipping..."
else
    # Add cron job
    (crontab -l 2>/dev/null; echo "$CRON_TIME $BACKUP_SCRIPT >> /var/log/brain-web-backup.log 2>&1") | crontab -
    echo "✓ Cron job created"
fi

# Step 3: Create log file
echo ""
echo "Step 3: Creating log file..."
sudo touch /var/log/brain-web-backup.log
sudo chmod 644 /var/log/brain-web-backup.log

# Step 4: Test backup script
echo ""
echo "Step 4: Testing backup script..."
$BACKUP_SCRIPT

echo ""
echo "=========================================="
echo "Backup Automation Setup Complete!"
echo "=========================================="
echo ""
echo "Backup schedule: Daily at 2:00 AM UTC"
echo "Backup location: /root/backups"
echo "Log file: /var/log/brain-web-backup.log"
echo ""
echo "View cron jobs: crontab -l"
echo "View backup logs: tail -f /var/log/brain-web-backup.log"
echo "Manual backup: $BACKUP_SCRIPT"
echo ""
