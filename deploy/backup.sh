#!/usr/bin/env bash
# Dumps the database, keeps 14 days on this machine and copies each dump to R2.
# Daily at 03:00 (crontab -e): 0 3 * * * /home/deploy/closet-ai/deploy/backup.sh >> /home/deploy/backup.log 2>&1
set -euo pipefail
# Dumps hold every user's data: readable by this user only.
umask 077
cd "$(dirname "$0")"

# Read as plain KEY=value, the way Compose does. Sourcing .env would run its values as bash.
value() { grep -m1 "^$1=" .env | cut -d= -f2-; }
endpoint="$(value S3_ENDPOINT)"
access_key="$(value S3_ACCESS_KEY_ID)"
secret_key="$(value S3_SECRET_ACCESS_KEY)"
bucket="$(value BACKUP_BUCKET)"

mkdir -p backups
file="closet-$(date -u +%Y-%m-%d-%H%M).sql.gz"
# Written under a temporary name, so a failed dump never looks like a backup.
trap 'rm -f "backups/$file.tmp"' EXIT
docker compose exec -T postgres pg_dump -U closet closet | gzip > "backups/$file.tmp"
# An empty database still dumps kilobytes; anything smaller means pg_dump failed.
[ "$(wc -c < "backups/$file.tmp")" -gt 1000 ] || { echo "backup too small: $file" >&2; exit 1; }
mv "backups/$file.tmp" "backups/$file"

# AWS's image saves installing anything. The checksum setting is what R2 needs from this CLI.
docker run --rm -v "$PWD/backups:/backups:ro" \
  -e AWS_ACCESS_KEY_ID="$access_key" -e AWS_SECRET_ACCESS_KEY="$secret_key" \
  -e AWS_DEFAULT_REGION=auto -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required \
  amazon/aws-cli:2.27.0 s3 cp "/backups/$file" "s3://$bucket/$file" --endpoint-url "$endpoint"

find backups -name 'closet-*.sql.gz' -mtime +14 -delete
echo "backup done: $file"
