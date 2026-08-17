#!/usr/bin/env bash
# Inject API URL into frontend config before Vercel deploy
set -e
API_URL="${NEXT_PUBLIC_API_URL:-${ECOOM_API_URL:-http://localhost:8787}}"
cat > web/config.js <<EOF
window.ECOOM_API_URL = "${API_URL}";
EOF
echo "✅ web/config.js → ${API_URL}"
