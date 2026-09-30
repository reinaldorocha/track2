#!/usr/bin/env bash

# ==============================================================================
# UTM-TRACK — SCRIPT DE INSTALAÇÃO 100% AUTOMATIZADA NA VPS (DOCKER)
# ==============================================================================

set -e

# Cores para saída no terminal
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # Sem cor

echo -e "${CYAN}==============================================================================${NC}"
echo -e "${CYAN}        UTM-TRACK — INSTALAÇÃO AUTOMATIZADA EM VPS (DOCKER / PORTA 3030)     ${NC}"
echo -e "${CYAN}==============================================================================${NC}\n"

# 1. Verificar comandos obrigatórios
echo -e "${YELLOW}>> 1. Verificando pré-requisitos do sistema...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}[ERRO] Docker não está instalado nesta VPS.${NC}"
    echo -e "Instale executando: ${CYAN}curl -fsSL https://get.docker.com | sh${NC}"
    exit 1
fi

DOCKER_COMPOSE_CMD=""
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
else
    echo -e "${RED}[ERRO] Docker Compose não encontrado.${NC}"
    echo -e "Instale o plugin docker-compose antes de prosseguir."
    exit 1
fi

echo -e "${GREEN}[OK] Docker e Docker Compose detectados: $DOCKER_COMPOSE_CMD${NC}\n"

# 2. Configurar o Domínio (ÚNICA PERGUNTA AO USUÁRIO)
echo -e "${YELLOW}>> 2. Configuração do Domínio...${NC}"
EXISTING_DOMAIN=""
if [ -f ".env.production" ]; then
    EXISTING_DOMAIN=$(grep -E '^NEXT_PUBLIC_APP_URL=' .env.production | cut -d '=' -f2 | tr -d '"' | tr -d "'")
fi

PROMPT_TEXT="Informe o domínio da aplicação [ex: track.seudominio.com.br]: "
if [ -n "$EXISTING_DOMAIN" ]; then
    PROMPT_TEXT="Informe o domínio da aplicação [Enter para manter $EXISTING_DOMAIN]: "
fi

read -p "$PROMPT_TEXT" USER_DOMAIN
USER_DOMAIN=${USER_DOMAIN:-$EXISTING_DOMAIN}
USER_DOMAIN=${USER_DOMAIN:-"track.seudominio.com.br"}

# Normalizar URL (remover protocolo e barras para isolar o domínio limpo)
DOMAIN_CLEAN=$(echo "$USER_DOMAIN" | sed -e 's|https://||' -e 's|http://||' -e 's|"||g' -e 's|/.*||')
APP_URL="https://${DOMAIN_CLEAN}"

echo -e "${GREEN}[OK] Domínio configurado: ${CYAN}${APP_URL}${NC}\n"

# 3. Localizar PostgreSQL e obter credenciais automaticamente
echo -e "${YELLOW}>> 3. Localizando PostgreSQL automaticamente na VPS...${NC}"

PG_CONTAINER=""
PG_HOST=""
PG_NETWORK="stack_default"

# Prioridade 1: stack-postgres
if docker ps --format '{{.Names}}' | grep -q "^stack-postgres$"; then
    PG_CONTAINER="stack-postgres"
    PG_HOST="stack-postgres"
    PG_NETWORK="stack_default"
# Prioridade 2: supabase-db
elif docker ps --format '{{.Names}}' | grep -q "^supabase-db$"; then
    PG_CONTAINER="supabase-db"
    PG_HOST="supabase-db"
    PG_NETWORK="supabase_default"
else
    # Buscar qualquer container que contenha 'postgres' no nome
    PG_CONTAINER=$(docker ps --format '{{.Names}}' | grep -i 'postgres' | head -n 1)
    if [ -n "$PG_CONTAINER" ]; then
        PG_HOST="$PG_CONTAINER"
        DETECTED_NET=$(docker inspect "$PG_CONTAINER" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{println}}{{end}}' | head -n 1)
        if [ -n "$DETECTED_NET" ]; then
            PG_NETWORK="$DETECTED_NET"
        fi
    fi
fi

if [ -z "$PG_CONTAINER" ]; then
    echo -e "${RED}[ERRO] Nenhum container PostgreSQL em execução foi encontrado na VPS!${NC}"
    echo -e "Verifique seus containers rodando: ${CYAN}docker ps${NC}"
    exit 1
fi

echo -e "${GREEN}[OK] PostgreSQL detectado no container '${CYAN}${PG_CONTAINER}${GREEN}' (Rede Docker: '${CYAN}${PG_NETWORK}${GREEN}')${NC}"

# Extrair usuário e senha do container automaticamente
DB_USER=$(docker inspect "$PG_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POSTGRES_USER=' | cut -d= -f2-)
DB_USER=${DB_USER:-"postgres"}

DB_PASS=$(docker inspect "$PG_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POSTGRES_PASSWORD=' | cut -d= -f2-)

if [ -z "$DB_PASS" ]; then
    echo -e "${YELLOW}[AVISO] Senha não identificada automaticamente nas variáveis do container.${NC}"
    read -s -p "Digite a senha do PostgreSQL do container ${PG_CONTAINER}: " DB_PASS
    echo ""
else
    echo -e "${GREEN}[OK] Credenciais de acesso detectadas automaticamente.${NC}"
fi

# Garantir que a rede Docker existe
if ! docker network inspect "$PG_NETWORK" &>/dev/null; then
    echo -e "${CYAN}Criando rede Docker '${PG_NETWORK}'...${NC}"
    docker network create "$PG_NETWORK"
fi

# Ajustar o nome da rede no docker-compose.yml se for diferente de stack_default
sed -i "/app_network:/,/external:/ s/name: .*/name: ${PG_NETWORK}/" docker-compose.yml 2>/dev/null || true

# Garantir que o banco de dados utmtrack existe no Postgres
echo -e "${YELLOW}>> Verificando banco de dados 'utmtrack'...${NC}"
DB_CHECK=$(docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'utmtrack'" 2>/dev/null || echo "")

if [[ "$DB_CHECK" == *"1"* ]]; then
    echo -e "${GREEN}[OK] Banco de dados 'utmtrack' já existe no PostgreSQL.${NC}"
else
    echo -e "${CYAN}Criando banco de dados 'utmtrack' no container ${PG_CONTAINER}...${NC}"
    docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE utmtrack;"
    echo -e "${GREEN}[OK] Banco de dados 'utmtrack' criado com sucesso!${NC}"
fi

# 4. Geração de Chaves Criptográficas e Escrita do .env.production
echo -e "\n${YELLOW}>> 4. Gerando chaves criptográficas de segurança e configurando .env.production...${NC}"

if command -v openssl &> /dev/null; then
    GEN_NEXTAUTH_SECRET=$(openssl rand -base64 32)
    GEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
else
    GEN_NEXTAUTH_SECRET=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 44 | head -n 1)
    GEN_ENCRYPTION_KEY=$(cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 64 | head -n 1)
fi

# Se já houver chaves anteriores, preservá-las para não invalidar sessões
if [ -f ".env.production" ]; then
    OLD_NEXTAUTH_SECRET=$(grep -E '^NEXTAUTH_SECRET=' .env.production | cut -d '=' -f2 | tr -d '"' | tr -d "'")
    OLD_ENCRYPTION_KEY=$(grep -E '^ENCRYPTION_KEY=' .env.production | cut -d '=' -f2 | tr -d '"' | tr -d "'")
    
    if [ -n "$OLD_NEXTAUTH_SECRET" ]; then
        GEN_NEXTAUTH_SECRET="$OLD_NEXTAUTH_SECRET"
    fi
    if [ -n "$OLD_ENCRYPTION_KEY" ]; then
        GEN_ENCRYPTION_KEY="$OLD_ENCRYPTION_KEY"
    fi
fi

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${PG_HOST}:5432/utmtrack?schema=public"

cat <<EOF > .env.production
# ==============================================================================
# UTM-TRACK — VARIÁVEIS DE AMBIENTE DE PRODUÇÃO (VPS)
# ==============================================================================

# URLs da Aplicação
NEXT_PUBLIC_APP_URL="${APP_URL}"
NEXTAUTH_URL="${APP_URL}"

# Chaves de Autenticação JWT e Sessão
NEXTAUTH_SECRET="${GEN_NEXTAUTH_SECRET}"
AUTH_SECRET="${GEN_NEXTAUTH_SECRET}"
AUTH_TRUST_HOST=true

# Chave Mestre de Criptografia AES-256-GCM (Tokens Meta e Webhooks)
ENCRYPTION_KEY="${GEN_ENCRYPTION_KEY}"

# Conexão PostgreSQL (Rede Interna Docker: ${PG_NETWORK})
DATABASE_URL="${DATABASE_URL}"

# Ambiente
NODE_ENV="production"
PORT=3000
EOF

echo -e "${GREEN}[OK] .env.production gerado e configurado com sucesso.${NC}"

# 5. Compilar a Imagem Docker
echo -e "\n${YELLOW}>> 5. Construindo a imagem Docker da aplicação (Next.js + Prisma)...${NC}"
$DOCKER_COMPOSE_CMD build

# 6. Sincronizar Schema no PostgreSQL
echo -e "\n${YELLOW}>> 6. Sincronizando tabelas no PostgreSQL (Prisma db push)...${NC}"
if ! $DOCKER_COMPOSE_CMD run --rm utm-track npx prisma db push; then
    echo -e "${RED}[AVISO] Houve uma falha ao aplicar o schema no PostgreSQL.${NC}"
    echo -e "Deseja tentar iniciar o container mesmo assim? (s/N): "
    read -r CONT
    if [[ ! "$CONT" =~ ^[Ss]$ ]]; then
        exit 1
    fi
fi

# 7. Iniciar Container
echo -e "\n${YELLOW}>> 7. Inicializando o container em segundo plano...${NC}"
$DOCKER_COMPOSE_CMD up -d --remove-orphans

sleep 3

# 8. Validar Status
echo -e "\n${YELLOW}>> 8. Status do container:${NC}"
docker ps -f name=utm-track

echo -e "\n${GREEN}==============================================================================${NC}"
echo -e "${GREEN}   UTM-TRACK INSTALADO E EM EXECUÇÃO NO DOCKER NA PORTA LOCAL 3030!          ${NC}"
echo -e "${GREEN}==============================================================================${NC}"

echo -e "\n${CYAN}>> Como configurar no seu Nginx Proxy Manager (NPM):${NC}"
echo -e "1. Acesse o seu painel do Nginx Proxy Manager no navegador."
echo -e "2. Vá em ${YELLOW}Proxy Hosts${NC} -> ${YELLOW}Add Proxy Host${NC} e preencha:"
echo -e "   - ${CYAN}Domain Names:${NC} ${DOMAIN_CLEAN}"
echo -e "   - ${CYAN}Scheme:${NC} http"
echo -e "   - ${CYAN}Forward Hostname / IP:${NC} utm-track"
echo -e "   - ${CYAN}Forward Port:${NC} 3000"
echo -e "   - Ative: ${YELLOW}Block Common Exploits${NC} e ${YELLOW}Websockets Support${NC}"
echo -e "3. Na aba ${YELLOW}SSL${NC}:"
echo -e "   - Selecione: ${YELLOW}Request a new SSL Certificate${NC}"
echo -e "   - Ative: ${YELLOW}Force SSL${NC} e concorde com os termos do Let's Encrypt."
echo -e "4. Clique em ${GREEN}Save${NC} e pronto! Sua aplicação estará no ar com HTTPS.\n"

echo -e "${CYAN}>> (Opcional) Caso utilize Nginx tradicional por arquivo de configuração:${NC}"
echo -e "------------------------------------------------------------------------------"
cat <<EOF
server {
    server_name ${DOMAIN_CLEAN};

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    location /tracker.js {
        proxy_pass http://127.0.0.1:3030/tracker.js;
        proxy_set_header Host \$host;
        add_header Access-Control-Allow-Origin *;
        add_header Cache-Control "public, max-age=3600, stale-while-revalidate=86400";
    }
}
EOF
echo -e "------------------------------------------------------------------------------\n"
