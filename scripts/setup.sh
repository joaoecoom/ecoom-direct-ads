#!/usr/bin/env bash
# Setup Ecoom Direct ADS — Google Veo / Vertex AI
# Corre UMA VEZ: npm run setup

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Ecoom Direct ADS — Setup Google Veo (Vertex AI)${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo "Este script faz quase tudo por ti."
echo "Só vais precisar de CLICAR no browser quando o Google pedir login."
echo ""

# ── 1. Node dependencies ──────────────────────────────────────────
echo "📦 A instalar dependências Node..."
npm install --silent

# ── 2. Google Cloud CLI ───────────────────────────────────────────
if ! command -v gcloud &>/dev/null; then
  echo ""
  echo -e "${YELLOW}☁️  A instalar Google Cloud CLI (gcloud)...${NC}"
  echo "   (Pode demorar 2-3 minutos)"
  if command -v brew &>/dev/null; then
    brew install --cask google-cloud-sdk
    # Homebrew cask path
    if [ -f "/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/path.bash.inc" ]; then
      source "/opt/homebrew/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/path.bash.inc"
    elif [ -f "$HOME/google-cloud-sdk/path.bash.inc" ]; then
      source "$HOME/google-cloud-sdk/path.bash.inc"
    fi
  else
    echo -e "${RED}❌ Homebrew não encontrado. Instala gcloud manualmente:${NC}"
    echo "   https://cloud.google.com/sdk/docs/install"
    exit 1
  fi
fi

echo -e "✅ gcloud: $(gcloud --version 2>/dev/null | head -1)"

# ── 3. Login Google (gcloud + ADC) ─────────────────────────────────
echo ""
echo -e "${YELLOW}🔐 PASSO 1/2 — Login gcloud (abre browser)${NC}"
echo "   Conta Google com os \$300 de créditos. Aceita tudo."
echo ""
read -p "   Prima ENTER para abrir o login... " _

if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q .; then
  gcloud auth login
else
  echo "   Já autenticado: $(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -1)"
fi

echo ""
echo -e "${YELLOW}🔐 PASSO 2/2 — Credenciais para a app (ADC)${NC}"
read -p "   Prima ENTER para abrir o 2.º login (normal, são 2)... " _
gcloud auth application-default login --quiet 2>/dev/null || gcloud auth application-default login

echo ""
echo -e "✅ Login Google concluído"

# ── 4. Projecto GCP ───────────────────────────────────────────────
echo ""
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")

if [ -n "$CURRENT_PROJECT" ] && [ "$CURRENT_PROJECT" != "(unset)" ]; then
  echo "Projecto actual: $CURRENT_PROJECT"
  read -p "Usar este projecto? [S/n] " USE_CURRENT
  USE_CURRENT=${USE_CURRENT:-S}
  if [[ "$USE_CURRENT" =~ ^[Ss]$ ]]; then
    PROJECT_ID="$CURRENT_PROJECT"
  fi
fi

pick_existing_project() {
  echo ""
  echo "Projectos na tua conta:"
  gcloud projects list --format="table(projectId,name)" 2>/dev/null || true
  echo ""
  read -p "Copia e cola o Project ID da lista acima: " PROJECT_ID
}

create_new_project() {
  for attempt in 1 2 3; do
    RANDOM_SUFFIX=$(openssl rand -hex 3 2>/dev/null || date +%s | tail -c 7)
    PROJECT_ID="ecoom-ads-${RANDOM_SUFFIX}"
    echo "A criar projecto: $PROJECT_ID — tentativa ${attempt} de 3"
    if gcloud projects create "$PROJECT_ID" --name="Ecoom Direct ADS" 2>&1; then
      echo -e "✅ Projecto criado: $PROJECT_ID"
      return 0
    fi
    sleep 1
  done
  echo -e "${YELLOW}⚠️  Não consegui criar automaticamente.${NC}"
  pick_existing_project
}

if [ -z "$PROJECT_ID" ]; then
  echo ""
  echo "Opções:"
  echo "  1) Criar projecto novo (recomendado se tens trial \$300)"
  echo "  2) Escolher projecto existente (lista os teus)"
  read -p "Escolhe [1/2]: " PROJECT_CHOICE

  if [ "$PROJECT_CHOICE" = "1" ]; then
    create_new_project
  else
    pick_existing_project
  fi
fi

if [ -z "$PROJECT_ID" ]; then
  echo -e "${RED}❌ Project ID vazio. Corre de novo: npm run setup${NC}"
  exit 1
fi

gcloud config set project "$PROJECT_ID"
echo -e "✅ Projecto activo: $PROJECT_ID"

# ── 5. Billing (aviso) ────────────────────────────────────────────
echo ""
echo -e "${YELLOW}💳 Billing${NC}"
echo "   Para Veo funcionar, o projecto precisa de billing activo."
echo "   Se és conta nova, activa o trial \$300 em:"
echo "   https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
echo ""
read -p "   Já activaste billing neste projecto? [S/n] " BILLING_OK
BILLING_OK=${BILLING_OK:-S}
if [[ ! "$BILLING_OK" =~ ^[Ss]$ ]]; then
  echo ""
  echo "Abre o link acima, activa billing, e corre de novo: npm run setup"
  open "https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID" 2>/dev/null || true
  exit 0
fi

# ── 6. Activar APIs ───────────────────────────────────────────────
echo ""
echo "🔧 A activar APIs (Vertex AI + Storage)..."
gcloud services enable aiplatform.googleapis.com --project="$PROJECT_ID"
gcloud services enable storage.googleapis.com --project="$PROJECT_ID"
echo -e "✅ APIs activadas"

# ── 7. Bucket GCS ─────────────────────────────────────────────────
BUCKET_NAME="${PROJECT_ID}-veo-output"
BUCKET_URI="gs://${BUCKET_NAME}/output/"

echo ""
echo "🪣 A criar bucket para vídeos: $BUCKET_NAME"
if gsutil ls "gs://${BUCKET_NAME}" &>/dev/null; then
  echo "   Bucket já existe — OK"
else
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="$PROJECT_ID" \
    --location=us-central1 \
    --uniform-bucket-level-access 2>/dev/null || \
  gsutil mb -l us-central1 "gs://${BUCKET_NAME}" 2>/dev/null || {
    echo -e "${YELLOW}⚠️  Não consegui criar bucket automaticamente.${NC}"
    echo "   Cria manualmente em: https://console.cloud.google.com/storage/create-bucket?project=$PROJECT_ID"
    read -p "   Introduz URI gs:// do bucket (ex: gs://meu-bucket/output/): " BUCKET_URI
  }
fi

# ── 8. Região ─────────────────────────────────────────────────────
LOCATION="global"
echo -e "✅ Região Vertex AI: $LOCATION"

# ── 9. Escrever .env ──────────────────────────────────────────────
cat > "$ROOT/.env" << EOF
# Gerado automaticamente por npm run setup — $(date)
GOOGLE_CLOUD_PROJECT=$PROJECT_ID
GOOGLE_CLOUD_LOCATION=$LOCATION
GCS_OUTPUT_URI=$BUCKET_URI
VEO_MODEL=veo-3.1-fast-generate-001
OUTPUT_DIR=./output
EOF

# MCP Cursor — agente consegue usar Veo no chat
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
echo -e "✅ MCP Cursor configurado (.cursor/mcp.json)"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ SETUP CONCLUÍDO!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo "  Projecto:  $PROJECT_ID"
echo "  Bucket:    $BUCKET_URI"
echo "  Modelo:    veo-3.1-fast-generate-001"
echo ""
echo "  Testa agora:"
echo ""
echo '    npm run video -- "Anúncio premium de produto, luz dourada, 9:16 vertical"'
echo ""
echo "  Ou verifica tudo:"
echo ""
echo "    npm run check"
echo ""
