#!/usr/bin/env bash
# TransFlow — chẩn đoán chậm (web/upload) trên VPS. CHỈ ĐỌC: không restart, không sửa cấu hình.
# Không in secret (.env chỉ đọc DOMAIN / STORAGE_DOMAIN / FRONTEND_PORT).
#
# Chạy từ máy local (Windows Git Bash / Linux), kết quả lưu vào perf-report.txt:
#   ssh -i transflow-prod.pem <user>@<host> 'bash -s' < deploy/perf-diagnose.sh > perf-report.txt 2>&1
# Hoặc trên server:  bash /opt/transflow/deploy/perf-diagnose.sh | tee perf-report.txt
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/transflow}"
SINCE="${SINCE:-6h}"
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi

env_value() { { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null || true; } | tail -n1 | cut -d= -f2- | tr -d '\r"'"'"; }
DOMAIN="$(env_value DOMAIN)"
STORAGE_DOMAIN="$(env_value STORAGE_DOMAIN)"
FRONTEND_PORT="$(env_value FRONTEND_PORT)"; FRONTEND_PORT="${FRONTEND_PORT:-8081}"

sec() { printf '\n\n########## %s ##########\n' "$*"; }
run() { printf '\n$ %s\n' "$*"; bash -c "$*" 2>&1 | head -n "${LIMIT:-60}"; }

# curl timing: dns / connect / tls / TTFB / tổng / tốc độ / kích thước + cache Cloudflare
CURL_FMT='dns=%{time_namelookup}s connect=%{time_connect}s tls=%{time_appconnect}s ttfb=%{time_starttransfer}s total=%{time_total}s speed=%{speed_download}B/s size=%{size_download}B http=%{http_code}\n'
timing() { # $1=label $2=url [extra curl args]
  local label="$1" url="$2"; shift 2
  printf '%-34s ' "$label"
  curl -so /dev/null -w "$CURL_FMT" --max-time 60 "$@" "$url" || echo "FAILED"
}
cf_headers() { curl -sI --max-time 20 "$1" | grep -iE '^(HTTP|cf-cache-status|cf-ray|cache-control|content-length|content-encoding|age):' ; }

sec "0. Thời điểm"
date -u; uptime

sec "1. EC2 instance (region/AZ quyết định RTT tới người dùng)"
TOKEN="$(curl -s -m 2 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' || true)"
for k in instance-type placement/availability-zone; do
  printf '%s: ' "$k"; curl -s -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" "http://169.254.169.254/latest/meta-data/$k"; echo
done

sec "2. CPU / RAM / swap / IO"
run "nproc; free -m; swapon --show"
run "vmstat 1 5"          # r>4 = CPU nghẽn; si/so>0 = đang swap; wa cao = chờ đĩa; st>0 = bị steal
run "command -v iostat >/dev/null && iostat -x 1 3 || cat /proc/pressure/io /proc/pressure/cpu /proc/pressure/memory 2>/dev/null"
run "df -h / /var/lib/docker; df -i /"
run "lsblk -o NAME,SIZE,TYPE,MOUNTPOINT"
run "top -b -n1 -o %CPU | head -20"

sec "3. OOM / kernel"
LIMIT=30 run "$SUDO dmesg -T 2>/dev/null | grep -iE 'oom|killed process|blocked for more' | tail -20"

sec "4. Docker: trạng thái, restart, OOMKilled, tài nguyên"
run "docker ps --format 'table {{.Names}}\t{{.Status}}'"
run "for c in \$(docker ps -aq); do docker inspect -f '{{.Name}} restarts={{.RestartCount}} oom={{.State.OOMKilled}} started={{.State.StartedAt}}' \$c; done"
run "docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}'"
run "docker system df"

sec "5. Hàng đợi RabbitMQ (job tồn đọng => worker/ai đang chiếm CPU)"
run "docker exec transflow-rabbitmq rabbitmqctl -q list_queues name messages_ready messages_unacknowledged consumers"

sec "6. PostgreSQL: kết nối & truy vấn chạy lâu"
printf '\n$ psql pg_stat_activity\n'
docker exec -i transflow-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' 2>&1 <<'SQL' | head -40
select state, count(*) from pg_stat_activity group by 1;
select pid, now()-query_start as dur, state, left(query,120) from pg_stat_activity
 where state<>'idle' and now()-query_start > interval '1 second' order by dur desc limit 10;
SQL

sec "7. Log backend-main ($SINCE): timeout / pool / GC / lỗi"
LIMIT=40 run "docker logs --since $SINCE transflow-backend-main 2>&1 | grep -iE 'timeout|hikari|connection is not available|outofmemory|GC overhead|slow|ERROR' | tail -40"
LIMIT=20 run "docker logs --since $SINCE transflow-backend-main 2>&1 | grep -ciE 'upload|chunk'"

sec "8. Log backend-ai / media-worker ($SINCE): job nặng đang chạy"
LIMIT=25 run "docker logs --since $SINCE transflow-media-worker 2>&1 | grep -iE 'render|ffmpeg|error' | tail -20"
LIMIT=25 run "docker logs --since $SINCE transflow-backend-ai 2>&1 | grep -iE 'demucs|separation|stt|error|timeout' | tail -20"

sec "9. nginx host: mã lỗi & upstream"
AL=/var/log/nginx/access.log; EL=/var/log/nginx/error.log
run "$SUDO awk '{print \$9}' $AL | sort | uniq -c | sort -rn | head -12"        # 429/499/502/504 là manh mối
LIMIT=20 run "$SUDO grep -E '\" (429|499|502|503|504) ' $AL | tail -15"
LIMIT=25 run "$SUDO grep -iE 'upstream timed out|limiting (requests|connections)|client intended to send too large|buffered to a temporary file|no live upstreams' $EL | tail -20"
run "$SUDO grep -icE 'buffered to a temporary file' $EL"
LIMIT=20 run "$SUDO awk '{print \$7}' $AL | sed 's/?.*//' | grep -E '\\.(mp4|png|jpe?g)\$' | sort | uniq -c | sort -rn | head -10"   # file media tĩnh bị kéo từ origin

sec "10. Mạng"
run "ss -s"
run "ss -tn state established '( sport = :443 )' | wc -l"

sec "11. Timing: bypass Cloudflare (loopback) vs qua Cloudflare"
ASSET="$(curl -s --max-time 10 http://127.0.0.1:$FRONTEND_PORT/ | grep -oE '/assets/[^\"]+\.js' | head -1)"
timing "origin  / (index.html)"          "http://127.0.0.1:$FRONTEND_PORT/"
timing "origin  $ASSET"                  "http://127.0.0.1:$FRONTEND_PORT$ASSET"
timing "origin  /landing/videos/dark1.mp4" "http://127.0.0.1:$FRONTEND_PORT/landing/videos/dark1.mp4"
if [ -n "$DOMAIN" ]; then
  timing "CF      / (index.html)"        "https://$DOMAIN/" --compressed
  timing "CF      $ASSET"                "https://$DOMAIN$ASSET" --compressed
  timing "CF      /landing/.../dark1.mp4" "https://$DOMAIN/landing/videos/dark1.mp4"
  timing "CF      /api (401 expected)"   "https://$DOMAIN/api/workspaces"
  printf '\n-- Cloudflare cache headers --\n'
  for p in / "$ASSET" /landing/videos/dark1.mp4 /auth_circle_loop.mp4; do echo "[$p]"; cf_headers "https://$DOMAIN$p"; done
fi
[ -n "$STORAGE_DOMAIN" ] && timing "CF      storage healthz"   "https://$STORAGE_DOMAIN/healthz"

sec "12. Ghi đĩa tuần tự (EBS; ghi/xoá 256MB tạm)"
run "dd if=/dev/zero of=/tmp/tf-ddtest bs=8M count=32 oflag=direct 2>&1 | tail -1; rm -f /tmp/tf-ddtest"

sec "XONG"
