#!/usr/bin/env bash
#
# serve.sh  Serve the Oathsworn webapp via Caddy in Docker.
#
# Usage:
#   ./serve.sh                           Local:  http://localhost:8080
#   ./serve.sh --port 3000               Local:  http://localhost:3000
#   ./serve.sh --domain example.com      Public: https://example.com  (Let's Encrypt)
#   ./serve.sh -d                        Run detached (background)
#   ./serve.sh --stop                    Stop a running server
#
# For public HTTPS, ports 80 and 443 must be open and the domain must
# resolve to this machine before starting.
#
# Requires: Docker with the Compose plugin (docker compose)

set -euo pipefail

DOMAIN=""
PORT=8080
DETACH=false
STOP=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --domain)    DOMAIN="$2"; shift 2 ;;
        --port)      PORT="$2";   shift 2 ;;
        -d|--detach) DETACH=true; shift ;;
        --stop)      STOP=true;   shift ;;
        -h|--help)   sed -n 's/^# \?//p' "$0" | head -20; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

if ! command -v docker &>/dev/null; then
    echo "Error: docker is not installed or not on PATH." >&2
    exit 1
fi

# --stop: bring down whatever compose project is running here
if [[ "$STOP" == true ]]; then
    if [[ ! -f docker-compose.yml ]]; then
        echo "No docker-compose.yml found — is a server running from this directory?" >&2
        exit 1
    fi
    docker compose down
    exit 0
fi

# --- Generate Caddyfile ---

if [[ -n "$DOMAIN" ]]; then
    cat > Caddyfile <<EOF
$DOMAIN {
    root * /srv
    file_server
    encode gzip
}
EOF
else
    cat > Caddyfile <<EOF
:$PORT {
    root * /srv
    file_server
    encode gzip
}
EOF
fi

# --- Generate docker-compose.yml ---

if [[ -n "$DOMAIN" ]]; then
    # Public HTTPS: expose 80 (ACME challenge + redirect) and 443 (TLS + HTTP/3)
    # caddy_data persists Let's Encrypt certificates across restarts
    cat > docker-compose.yml <<EOF
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./:/srv:ro
      - caddy_data:/data
      - caddy_config:/config
volumes:
  caddy_data:
  caddy_config:
EOF
else
    cat > docker-compose.yml <<EOF
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "${PORT}:${PORT}"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./:/srv:ro
      - caddy_config:/config
volumes:
  caddy_config:
EOF
fi

# --- Launch ---

if [[ -n "$DOMAIN" ]]; then
    echo "Starting Caddy for https://$DOMAIN"
    echo "Ensure ports 80 and 443 are open and $DOMAIN resolves to this machine."
    echo ""
else
    echo "Starting Caddy at http://localhost:$PORT"
    echo ""
fi

COMPOSE_FLAGS="--remove-orphans"
if [[ "$DETACH" == true ]]; then
    COMPOSE_FLAGS="$COMPOSE_FLAGS -d"
    echo "Running in background.  Stop with:  ./serve.sh --stop"
    echo ""
fi

docker compose up $COMPOSE_FLAGS
