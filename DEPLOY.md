# Deploying to the Ubuntu server

Target: **https://hospkpi.ambujaneotia.com**, app on **port 8016**, PostgreSQL
installed on the host (not Docker).

Paths below assume the checkout at
`/home/srvadmin/hotel_dashboard/hotel_dashboard`. Adjust if it lives elsewhere.

---

## 1. Check the port is free

The host already runs several apps (`catalog`, `news_app`, `ambuja_desk`,
`project_catalog`). Confirm nothing holds 8016 before starting:

```bash
sudo ss -ltnp | grep 8016      # no output = free
```

If it is taken, change `PORT` in `.env`, the `--port` in the systemd unit, and
`proxy_pass` in the nginx config — all three.

## 2. Database

Already created:

```sql
CREATE USER hotel_user WITH PASSWORD 'Hotel@123';
CREATE DATABASE hotel_db OWNER hotel_user;
GRANT ALL PRIVILEGES ON DATABASE hotel_db TO hotel_user;
```

`hotel_user` owns the database, so it can create the tables the app needs on
first start. Nothing else to run — there are no migrations to apply.

> **Do not** run `docker compose up -d`. That file is only for local
> development, where it puts PostgreSQL on port 5434 to avoid clashing with a
> locally installed server. On this host the database is already native on 5432.

## 3. `.env`

```bash
cd /home/srvadmin/hotel_dashboard/hotel_dashboard/backend
cp .env.example .env
nano .env
```

```ini
DATABASE_URL=postgresql+psycopg://hotel_user:Hotel%40123@localhost:5432/hotel_db
SECRET_KEY=<paste a fresh random string>
ACCESS_TOKEN_EXPIRE_MINUTES=720
STORAGE_DIR=storage/uploads
RETENTION_YEARS=2

FIRST_ADMIN_EMAIL=admin@ambujaneotia.com
FIRST_ADMIN_PASSWORD=<a strong password>

PUBLIC_BASE_URL=https://hospkpi.ambujaneotia.com
HOST=0.0.0.0
PORT=8016
SERVE_FRONTEND=true
CORS_ORIGINS=https://hospkpi.ambujaneotia.com
```

### The password must be percent-encoded

`Hotel@123` has to be written **`Hotel%40123`**. Left unencoded, the `@` is read
as the separator between credentials and host, and the URL silently resolves to
host `123@localhost` with password `Hotel` — the connection then fails with an
error that points nowhere near the real cause.

| char | encode as | | char | encode as |
|---|---|---|---|---|
| `@` | `%40` | | `#` | `%23` |
| `:` | `%3A` | | `?` | `%3F` |
| `/` | `%2F` | | `%` | `%25` |

Check it parses before starting the service:

```bash
venv/bin/python -c "
from sqlalchemy.engine import make_url
u = make_url(open('.env').read().split('DATABASE_URL=')[1].split()[0])
print('host', u.host, '| db', u.database, '| user', u.username)"
```

`host localhost | db hotel_db | user hotel_user` means it is right.

### Generate a SECRET_KEY

```bash
venv/bin/python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Rotating this key logs everyone out, which is the intended effect.

### File ownership

`.env` is read by the service running as `srvadmin`. If it was edited with
`sudo`, it is owned by root — readable, but fix it for tidiness, and make sure
the upload directory is writable:

```bash
sudo chown srvadmin:srvadmin .env
chmod 600 .env
mkdir -p storage/uploads
```

## 4. Build

```bash
cd /home/srvadmin/hotel_dashboard/hotel_dashboard

python3 -m venv backend/venv
backend/venv/bin/pip install -r backend/requirements.txt

cd frontend && npm ci && npm run build      # produces frontend/dist
```

The backend serves `frontend/dist` itself, so nginx needs no static root. Re-run
`npm run build` after every frontend change and restart the service.

## 5. systemd

Check first — `preflight.sh` verifies every path the unit references, the
dependencies, the database connection and the port, and names whichever one is
wrong:

```bash
cd /home/srvadmin/hotel_dashboard/hotel_dashboard/backend
bash preflight.sh
```

Then install it:

```bash
sudo cp hotel_dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hotel_dashboard
sudo systemctl status hotel_dashboard
```

### "Job for hotel_dashboard.service failed because of unavailable resources"

`Result: resources` means systemd could not set up the execution environment —
it never got as far as running the app, so there is no application error to
find. One of the absolute paths in the unit does not exist. The usual cause is
the virtualenv being somewhere other than `backend/venv`:

```bash
journalctl -xeu hotel_dashboard.service -n 40   # the actual reason
systemd-analyze verify /etc/systemd/system/hotel_dashboard.service
ls -l /home/srvadmin/hotel_dashboard/hotel_dashboard/backend/venv/bin/python
```

Fix the path in the unit (or move the venv), then
`sudo systemctl daemon-reload && sudo systemctl restart hotel_dashboard`.

It runs **uvicorn**, not gunicorn. This is an ASGI app; gunicorn's default
worker is WSGI and cannot serve it. The other services on this host are Flask,
which is why they differ.

Check it came up:

```bash
curl -s localhost:8016/api/health        # {"status":"ok"}
journalctl -u hotel_dashboard -n 40      # startup banner prints the public URL
```

## 6. nginx + TLS

```bash
sudo cp hotel_dashboard.nginx.conf /etc/nginx/sites-available/hotel_dashboard
sudo ln -s /etc/nginx/sites-available/hotel_dashboard /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d hospkpi.ambujaneotia.com
```

The DNS A record for `hospkpi.ambujaneotia.com` must already point at this host,
or certbot cannot validate.

## 7. First sign-in

Open https://hospkpi.ambujaneotia.com and sign in with `FIRST_ADMIN_EMAIL` /
`FIRST_ADMIN_PASSWORD`. That account is created **only when the users table is
empty** — changing those values later does nothing; use Admin → Your account to
change the password instead.

Then upload each hotel's workbook from the Upload page.

---

## Updating a deployed instance

```bash
cd /home/srvadmin/hotel_dashboard/hotel_dashboard
git pull
backend/venv/bin/pip install -r backend/requirements.txt
cd frontend && npm ci && npm run build
sudo systemctl restart hotel_dashboard
```

## Where these files live

`hotel_dashboard.service` and `hotel_dashboard.nginx.conf` stay **in the
repository** as the source of truth, and are *copied* into `/etc/systemd/system/`
and `/etc/nginx/sites-available/` on deploy. Edit them here, commit, pull on the
server, copy again. Editing only the copies under `/etc` means the change is lost
at the next fresh deploy.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `the database system is starting up` | PostgreSQL still recovering after a reboot; systemd retries — the unit allows 10 restarts over 5 minutes |
| `connection to server at "123@localhost"` | Password not percent-encoded in `DATABASE_URL` |
| 502 from nginx | App not listening; `systemctl status hotel_dashboard` |
| Blank page, API works | `frontend/dist` missing — run `npm run build` |
| 413 on upload | `client_max_body_size` too low in the nginx config |
| Signed out unexpectedly | `SECRET_KEY` changed, which invalidates every issued token |
