#!/usr/bin/env bash
set -euo pipefail

cloud=${1:?Usage: select_web_ci_compose.sh CLOUD_CHECKOUT}
web_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
test -f "$cloud/docker-compose-web-ci.yml"

# Select by the immutable Server checkout, so older exact-artifact interop
# sources retain their original fixture instead of requiring a newer service.
admission="$cloud/libs/database/src/gateway_api_limits.rs"
routes="$cloud/nginx/api-limits-ci.conf"
if [[ -f "$admission" || -f "$routes" ]]; then
  if [[ ! -f "$admission" || ! -f "$routes" || ! -f "$cloud/docker-compose-ci.yml" ]]; then
    echo 'Incomplete Server Gateway admission fixture' >&2
    exit 1
  fi
  printf '%s\n' "$web_root/.github/docker-compose-web-ci.gateway.override.yml"
else
  printf '%s\n' "$web_root/.github/docker-compose-web-ci.override.yml"
fi
