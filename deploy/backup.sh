#!/usr/bin/env bash
# Dumps the database, keeps 14 days on this machine and copies each dump to R2.
# Daily at 03:00 (crontab -e): 0 3 * * * /home/deploy/closet-ai/deploy/backup.sh >> /home/deploy/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
set -a; source ./.env; set +a

mkdir -p backups
file="closet-$(date -u +%Y-%m-%d-%H%M).sql.gz"
docker compose exec -T postgres pg_dump -U closet closet | gzip > "backups/$file"
# An empty database still dumps kilobytes; anything smaller means pg_dump failed.
[ "$(wc -c < "backups/$file")" -gt 1000 ] || { echo "backup too small: $file" >&2; exit 1; }

# AWS's image saves installing anything. The checksum setting is what R2 needs from this CLI.
docker run --rm -v "$PWD/backups:/backups:ro" \
  -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
  -e AWS_DEFAULT_REGION=auto -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
  amazon/aws-cli:2.27.0 s3 cp "/backups/$file" "s3://$BACKUP_BUCKET/$file" --endpoint-url "$S3_ENDPOINT"

find backups -name 'closet-*.sql.gz' -mtime +14 -delete
echo "backup done: $file"
