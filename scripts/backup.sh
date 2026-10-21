#!/bin/bash
# API Monitor SaaS - Database Backup Script

set -e

BACKUP_DIR="/opt/api-monitor/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

mkdir -p $BACKUP_DIR/daily
mkdir -p $BACKUP_DIR/weekly

# Database backup
echo "Creating database backup..."
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/daily/backup_$DATE.sql.gz"

# Weekly backup (on Sundays)
if [ $(date +%u) -eq 7 ]; then
    cp "$BACKUP_DIR/daily/backup_$DATE.sql.gz" "$BACKUP_DIR/weekly/weekly_$DATE.sql.gz"
fi

# Cleanup old backups
find $BACKUP_DIR/daily -name "backup_*.sql.gz" -mtime +$RETENTION_DAYS -delete
find $BACKUP_DIR/weekly -name "weekly_*.sql.gz" -mtime +90 -delete

echo "Backup complete: backup_$DATE.sql.gz"
