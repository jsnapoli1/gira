#!/bin/bash
# Zira Database Backup Script
# Usage: ./scripts/backup-db.sh [backup_dir]
#
# Creates a timestamped SQLite backup using the .backup command
# for a consistent snapshot. Safe to run while the server is running.

set -euo pipefail

DB_PATH="${DB_PATH:-$HOME/.config/zira/zira.db}"
BACKUP_DIR="${1:-$HOME/.config/zira/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/zira_${TIMESTAMP}.db"

if [ ! -f "$DB_PATH" ]; then
    echo "Database not found at $DB_PATH"
    exit 1
fi

mkdir -p "$BACKUP_DIR"

# Use SQLite .backup for a consistent snapshot
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

echo "Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Keep last 30 backups, remove older ones
ls -t "$BACKUP_DIR"/zira_*.db 2>/dev/null | tail -n +31 | xargs -r rm
echo "Cleanup complete (keeping last 30 backups)"
