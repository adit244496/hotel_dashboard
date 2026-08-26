#!/usr/bin/env bash
# Check everything the systemd unit needs, before asking systemd to start it.
#
# systemd reports "Result: resources" for any failure to set up the execution
# environment — a missing interpreter, working directory or EnvironmentFile all
# look identical, and none of them reach the application. This says which.
#
#   cd backend && bash preflight.sh

set -uo pipefail

UNIT="${UNIT:-/etc/systemd/system/hotel_dashboard.service}"
BACKEND="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAIL=0

ok()   { printf '  \033[32m ok \033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=1; }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$1"; }

# Pull one directive out of a unit file. Uses awk rather than grep -oP, which
# needs a PCRE build of grep and a UTF-8 locale.
unit_value() {
    awk -v key="$1" '
        index($0, key "=") == 1 {
            line = substr($0, length(key) + 2)
            sub(/^-/, "", line)
            print line
            exit
        }' "$2" 2>/dev/null
}

echo
echo "Backend directory: $BACKEND"
echo

# --- what the unit actually asks for --------------------------------------
echo "1. Paths referenced by the unit file"
if [[ -f "$UNIT" ]]; then
    # ExecStart holds the interpreter followed by its arguments.
    EXEC_PY=$(unit_value ExecStart "$UNIT" | awk '{print $1}')
    WORKDIR=$(unit_value WorkingDirectory "$UNIT")
    ENVFILE=$(unit_value EnvironmentFile "$UNIT")
    RUNAS=$(unit_value User "$UNIT")
    ok "unit installed at $UNIT"
else
    warn "unit not installed yet; checking this checkout instead"
    EXEC_PY="$BACKEND/venv/bin/python"
    WORKDIR="$BACKEND"
    ENVFILE="$BACKEND/.env"
    RUNAS="$(id -un)"
fi

[[ -n "$EXEC_PY" && -x "$EXEC_PY" ]] \
    && ok  "interpreter   $EXEC_PY" \
    || bad "interpreter   ${EXEC_PY:-<none in unit>}  <- missing or not executable"
[[ -n "$WORKDIR" && -d "$WORKDIR" ]] \
    && ok  "workingdir    $WORKDIR" \
    || bad "workingdir    ${WORKDIR:-<none in unit>}  <- missing"
[[ -n "$ENVFILE" && -f "$ENVFILE" ]] \
    && ok  "env file      $ENVFILE" \
    || bad "env file      ${ENVFILE:-<none in unit>}  <- missing"
id "$RUNAS" &>/dev/null \
    && ok  "user          $RUNAS" \
    || bad "user          ${RUNAS:-<none in unit>}  <- no such user"

# The commonest cause is a unit copied to /etc before the last git pull.
if [[ -f "$UNIT" && -f "$BACKEND/hotel_dashboard.service" ]]; then
    if diff -q "$UNIT" "$BACKEND/hotel_dashboard.service" >/dev/null 2>&1; then
        ok "installed unit matches this checkout"
    else
        bad "installed unit differs from the one in this checkout"
        echo "       The copy under /etc is stale — reinstall it:"
        echo "         sudo cp $BACKEND/hotel_dashboard.service /etc/systemd/system/"
        echo "         sudo systemctl daemon-reload"
        echo "         sudo systemctl restart hotel_dashboard"
    fi
fi

# If the interpreter is missing, say where a virtualenv actually is.
if [[ -z "$EXEC_PY" || ! -x "$EXEC_PY" ]]; then
    echo
    echo "  Looking for a virtualenv:"
    # activate lives at <venv>/bin/activate, four levels below the repo root
    # (backend/venv/bin/activate), so search deeper than that.
    found=$(
        {
            [[ -n "${VIRTUAL_ENV:-}" ]] && echo "$VIRTUAL_ENV/bin/activate"
            find "$BACKEND/.." "$BACKEND/../.." -maxdepth 5 \
                 -name activate -path '*/bin/*' 2>/dev/null
        } | sort -u
    )
    printed=0
    while read -r a; do
        [[ -f "$a" ]] || continue
        echo "    $(dirname "$(dirname "$a")")"
        printed=1
    done <<< "$found"
    if [[ "$printed" == 1 ]]; then
        echo "    -> point ExecStart at <that path>/bin/python"
    else
        echo "    none found. Create one:"
        echo "       python3 -m venv $BACKEND/venv"
        echo "       $BACKEND/venv/bin/pip install -r $BACKEND/requirements.txt"
    fi
fi

# --- dependencies ----------------------------------------------------------
echo
echo "2. Python dependencies"
if [[ -n "$EXEC_PY" && -x "$EXEC_PY" ]]; then
    if "$EXEC_PY" -c 'import fastapi, uvicorn, sqlalchemy, psycopg, openpyxl' 2>/dev/null; then
        ok "fastapi, uvicorn, sqlalchemy, psycopg, openpyxl importable"
    else
        bad "a dependency is missing"
        "$EXEC_PY" -c 'import fastapi, uvicorn, sqlalchemy, psycopg, openpyxl' 2>&1 |
            tail -2 | sed 's/^/       /'
        echo "       $EXEC_PY -m pip install -r $BACKEND/requirements.txt"
    fi
else
    warn "skipped (no interpreter)"
fi

# --- configuration ---------------------------------------------------------
echo
echo "3. Configuration and database"
if [[ -n "$EXEC_PY" && -x "$EXEC_PY" && -n "$ENVFILE" && -f "$ENVFILE" ]]; then
    ( cd "$WORKDIR" && "$EXEC_PY" - <<'PY'
import sys

GREEN = "  \033[32m ok \033[0m "
RED = "  \033[31mFAIL\033[0m "

try:
    from app.core.config import settings
except Exception as exc:
    print(f"{RED}settings did not load: {type(exc).__name__}: {exc}")
    sys.exit(1)

from sqlalchemy.engine import make_url

try:
    url = make_url(settings.database_url)
except Exception as exc:
    print(f"{RED}DATABASE_URL will not parse: {exc}")
    sys.exit(1)

print(f"{GREEN}port {settings.port}, public {settings.public_base_url}")
print(
    f"{GREEN}db host={url.host} port={url.port} "
    f"name={url.database} user={url.username}"
)

# An unencoded '@' in the password swallows the host.
if url.host and "@" in str(url.host):
    print(
        f"{RED}host parsed as {url.host!r} - percent-encode the password "
        f"in DATABASE_URL (@ becomes %40)"
    )
    sys.exit(1)

from sqlalchemy import create_engine, text

try:
    with create_engine(settings.database_url).connect() as conn:
        conn.execute(text("select 1"))
    print(f"{GREEN}database connection")
except Exception as exc:
    print(f"{RED}cannot connect: {str(exc).splitlines()[0][:150]}")
    sys.exit(1)

dist = settings.frontend_dist
if dist.is_dir():
    print(f"{GREEN}frontend build present")
else:
    print(f"{RED}frontend build missing at {dist} - run 'npm run build'")
    sys.exit(1)
PY
    ) || FAIL=1
else
    warn "skipped (needs the interpreter and the env file)"
fi

# --- port ------------------------------------------------------------------
echo
echo "4. Port"
PORT=""
if [[ -f "$UNIT" ]]; then
    PORT=$(awk '{ for (i = 1; i <= NF; i++) if ($i == "--port") { print $(i+1); exit } }' "$UNIT")
fi
PORT="${PORT:-8016}"
if command -v ss &>/dev/null; then
    holder=$(ss -ltnp 2>/dev/null | grep -E ":${PORT}[[:space:]]" || true)
    if [[ -z "$holder" ]]; then
        ok "port $PORT is free"
    elif grep -q uvicorn <<< "$holder"; then
        ok "port $PORT held by uvicorn (the service is already running)"
    else
        bad "port $PORT is taken by something else:"
        echo "$holder" | sed 's/^/       /'
    fi
else
    warn "ss not available; skipped"
fi

echo
if [[ "$FAIL" == 0 ]]; then
    echo "All checks passed - sudo systemctl restart hotel_dashboard"
else
    echo "Fix the FAIL lines above, then re-run."
fi
exit "$FAIL"
