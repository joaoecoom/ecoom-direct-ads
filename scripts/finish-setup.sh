#!/usr/bin/env bash
# Termina o setup se já fizeste login e sabes o Project ID
# Uso: npm run setup:finish -- project-1f0c9cb1-6e86-47fe-a34b-xxxxxxxx

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_ID="${1:-}"

if [ -z "$PROJECT_ID" ]; then
  echo ""
  echo "Uso: npm run setup:finish -- TEU-PROJECT-ID"
  echo ""
  echo "Exemplo:"
  echo "  npm run setup:finish -- project-1f0c9cb1-6e86-47fe-a34b-8c2d1e0f9abc"
  echo ""
  echo "Copia o ID COMPLETO da consola Google Cloud (coluna ID)."
  exit 1
fi

export PATH="/opt/homebrew/share/google-cloud-sdk/bin:/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin:$HOME/google-cloud-sdk/bin:$PATH"

echo ""
echo -e "${GREEN}A terminar setup para: ${PROJECT_ID}${NC}"
echo ""

# gcloud CLI login (obrigatório para activar APIs — ADC sozinho não chega)
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q .; then
  echo -e "${YELLOW}🔐 Falta login gcloud — vai abrir o browser${NC}"
  read -p "Prima ENTER para login Google... " _
  gcloud auth login
fi

echo "Conta activa: $(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -1)"

gcloud config set project "$PROJECT_ID"

# Alinha quota project com ADC (evita warning)
gcloud auth application-default set-quota-project "$PROJECT_ID" 2>/dev/null || true

echo "🔧 A activar APIs..."
gcloud services enable aiplatform.googleapis.com --project="$PROJECT_ID"
gcloud services enable storage.googleapis.com --project="$PROJECT_ID"

BUCKET_NAME="${PROJECT_ID}-veo-output"
BUCKET_URI="gs://${BUCKET_NAME}/output/"

echo "🪣 Bucket: $BUCKET_NAME"
if ! gsutil ls "gs://${BUCKET_NAME}" &>/dev/null; then
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="$PROJECT_ID" \
    --location=us-central1 \
    --uniform-bucket-level-access 2>/dev/null || \
  gsutil mb -l us-central1 "gs://${BUCKET_NAME}"
fi

LOCATION="global"

cat > "$ROOT/.env" << EOF
# Gerado por setup:finish — $(date)
GOOGLE_CLOUD_PROJECT=$PROJECT_ID
GOOGLE_CLOUD_LOCATION=$LOCATION
GCS_OUTPUT_URI=$BUCKET_URI
VEO_MODEL=veo-3.1-fast-generate-001
OUTPUT_DIR=./output
EOF

mkdir -p "$ROOT/.cursor"
cat > "$ROOT/.cursor/mcp.json" << MCPEOF
{
  "mcpServers": {
    "vertex-ai": {
      "command": "npx",
      "args": ["-y", "vertex-ai-mcp"],
      "env": {
        "GOOGLE_PROJECT_ID": "$PROJECT_ID",
        "GOOGLE_LOCATION": "us-central1"
      }
    }
  }
}
MCPEOF

echo ""
echo -e "${GREEN}✅ SETUP CONCLUÍDO!${NC}"
echo "  Projecto: $PROJECT_ID"
echo "  Bucket:   $BUCKET_URI"
echo ""
echo '  Testa: npm run video -- "Anúncio teste produto premium 9:16"'
echo ""
