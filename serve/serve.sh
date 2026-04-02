#!/usr/bin/env bash
#
# serve.sh  Serve the Oathsworn webapp via Caddy in Docker.
#
# Usage:
#   ./serve.sh                           Local:  http://localhost:8080
#   ./serve.sh --port 3000               Local:  http://localhost:3000
#   ./serve.sh --domain example.com      Public: https://example.com  (Let's Encrypt)
#   ./serve.sh -d                        Run detached (background)
#   ./serve.sh --stop                    Stop a detached server
#
# For public HTTPS, ports 80 and 443 must be open and the domain must
# resolve to this machine before starting.
#
# Requires: Docker

set -euo pipefail

CONTAINER_NAME="oathsworn-caddy"
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

if [[ "$STOP" == true ]]; then
    docker stop "$CONTAINER_NAME"
    exit 0
fi

# Remove any existing stopped container with the same name
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

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

# --- Build docker run args ---

DOCKER_ARGS=(
    --name "$CONTAINER_NAME"
    --restart unless-stopped
    -v "$(pwd)/Caddyfile:/etc/caddy/Caddyfile:ro"
    -v "$(pwd):/srv:ro"
    -v "oathsworn-caddy-config:/config"
)

if [[ -n "$DOMAIN" ]]; then
    DOCKER_ARGS+=(
        -p "80:80"
        -p "443:443"
        -p "443:443/udp"
        -v "oathsworn-caddy-data:/data"
    )
    echo "Starting Caddy for https://$DOMAIN"
    echo "Ensure ports 80 and 443 are open and $DOMAIN resolves to this machine."
    echo ""
else
    DOCKER_ARGS+=(-p "${PORT}:${PORT}")
    echo "Starting Caddy at http://localhost:$PORT"
    echo ""
fi

if [[ "$DETACH" == true ]]; then
    DOCKER_ARGS+=(-d)
    echo "Running in background.  Stop with:  ./serve.sh --stop"
    echo ""
fi

docker run "${DOCKER_ARGS[@]}" caddy:2-alpine
