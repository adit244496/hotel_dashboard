#!/usr/bin/env bash
# Check everything the systemd unit needs, before asking systemd to start it.
#
# systemd reports "Result: resources" for any failure to set up the execution
# environment — a missing interpreter, working directory or EnvironmentFile all
# look identical. This pinpoints which one.
#
#   cd backend && bash preflight.sh

set -uo pipefail

UNIT="${UNIT:-/etc/systemd/system/hotel_dashboard.service}"
BACKEND="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0

ok()   { printf '  \033[32m ok \033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=1; }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$1"; }

echo
echo "Backend directory: $BACKEND"
echo

# --- what the unit actually asks for --------------------------------------
echo "1. Paths referenced by the unit file"
if [[ -f "$UNIT" ]]; then
    EXEC_PY=$(grep -oP '^ExecStart=\K[^ ]+' "$UNIT" | head -1)
    WORKDIR=$(grep -oP '^WorkingDirectory=\K.*' "$UNIT" | head -1)
    ENVFILE=$(grep -oP '^EnvironmentFile=-?\K.*' "$UNIT" | head -1)
    RUNAS=$(grep -oP '^User=\K.*' "$UNIT" | head -1)
    ok "unit installed at $UNIT"
else
    warn "unit not installed yet; checking this checkout instead"
    EXEC_PY="$BACKEND/venv/bin/python"
    WORKDIR="$BACKEND"
    ENVFILE="$BACKEND/.env"
    RUNAS="$(id -un)"
fi

[[ -x "$EXEC_PY" ]] && ok "interpreter   $EXEC_PY" \
                    || bad "interpreter   $EXEC_PY  <- missing or not executable"
[[ -d "$WORKDIR" ]] && ok "workingdir    $WORKDIR" \
                    || bad "workingdir    $WORKDIR  <- missing"
[[ -f "$ENVFILE" ]] && ok "env file      $ENVFILE" \
                    || bad "env file      $ENVFILE  <- missing"
id "$RUNAS" &>/dev/null && ok "user          $RUNAS" \
                        || bad "user          $RUNAS  <- no such user"

# If the interpreter is missing, say where a venv actually is.
if [[ ! -x "$EXEC_PY" ]]; then
    echo
    echo "  Looking for a virtualenv nearby:"
    found=$(find "$BACKEND/.." -maxdepth 3 -name activate -path '*/bin/*' 2>/dev/null | head -5)
    if [[ -n "$found" ]]; then
        while read -r a; do echo "    $(dirname "$(dirname "$a")")"; done <<< "$found"
        echo "    -> point ExecStart at <that path>/bin/python, or create one:"
    else
        echo "    none found. Create one:"
    fi
    echo "       python3 -m venv $BACKEND/venv"
    echo "       $BACKEND/venv/bin/pip install -r $BACKEND/requirements.txt"
fi

# --- dependencies ----------------------------------------------------------
echo
echo "2. Python dependencies"
if [[ -x "$EXEC_PY" ]]; then
    if "$EXEC_PY" -c 'import fastapi, uvicorn, sqlalchemy, psycopg, openpyxl' 2>/dev/null; then
        ok "fastapi, uvicorn, sqlalchemy, psycopg, openpyxl importable"
    else
        bad "dependencies missing -> $EXEC_PY -m pip install -r requirements.txt"
        "$EXEC_PY" -c 'import fastapi, uvicorn, sqlalchemy, psycopg, openpyxl' 2>&1 | tail -2 | sed 's/^/       /'
    fi
else
    warn "skipped (no interpreter)"
fi

# --- configuration ---------------------------------------------------------
echo
echo "3. Configuration and database"
if [[ -x "$EXEC_PY" && -f "$ENVFILE" ]]; then
    ( cd "$WORKDIR" && "$EXEC_PY" - <<'PY'
import sys
try:
    from app.core.config import settings
except Exception as exc:
    print(f"  FAIL settings did not load: {type(exc).__name__}: {exc}")
    sys.exit(1)

from sqlalchemy.engine import make_url
try:
    url = make_url(settings.database_url)
except Exception as exc:
    print(f"  FAIL DATABASE_URL will not parse: {exc}")
    sys.exit(1)

print(f"   ok  port {settings.port}, public {settings.public_base_url}")
print(f"   ok  db host={url.host} port={url.port} name={url.database} user={url.username}")

# A '@' left unencoded in the password swallows the host.
if url.host and "@" in str(url.host):
    print(f"  FAIL host parsed as {url.host!r} - percent-encode the password (@ -> %40)")
    sys.exit(1)

from sqlalchemy import create_engine, text
try:
    with create_engine(settings.database_url).connect() as c:
        c.execute(text("select 1"))
    print("   ok  database connection")
except Exception as exc:
    print(f"  FAIL cannot connect: {str(exc).splitlines()[0][:150]}")
    sys.exit(1)

dist = settings.frontend_dist
print(f"   ok  frontend build present at {dist}" if dist.is_dir()
      else f"  FAIL frontend build missing at {dist} - run 'npm run build'")
sys.exit(0 if dist.is_dir() else 1)
PY
    ) || FAIL=1
else
    warn "skipped (need interpreter and env file)"
fi

# --- port ------------------------------------------------------------------
echo
echo "4. Port"
PORT=$(grep -oP '^\s*--port\s+\K[0-9]+' "$UNIT" 2>/dev/null | head -1)
PORT="${PORT:-8016}"
if command -v ss &>/dev/null; then
    holder=$(ss -ltnp 2>/dev/null | grep -E ":${PORT}\b" || true)
    if [[ -z "$holder" ]]; then
        ok "port $PORT is free"
    elif grep -q uvicorn <<< "$holder"; then
        ok "port $PORT already held by uvicorn (this service is running)"
    else
        bad "port $PORT is taken by something else:"
        echo "$holder" | sed 's/^/       /'
    fi
else
    warn "ss not available; skipped"
fi

echo
if [[ "$FAIL" == 0 ]]; then
    echo "All checks passed — sudo systemctl restart hotel_dashboard"
else
    echo "Fix the FAIL lines above, then re-run."
fi
exit "$FAIL"
