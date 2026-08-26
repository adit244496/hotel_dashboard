"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import auth, dashboard, hotels, uploads
from app.core.config import settings
from app.db.init_db import init_db

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    log = logging.getLogger(__name__)
    log.info("Public URL : %s", settings.public_base_url)
    log.info("Listening  : %s:%s", settings.host, settings.port)
    log.info(
        "Frontend   : %s",
        "served from this process" if settings.serve_frontend else "disabled",
    )
    yield


app = FastAPI(
    title="Hotel Performance Dashboard",
    version="1.0.0",
    description=(
        "Monthly MIS ingestion and reporting for the hotel portfolio. Admins "
        "upload each property's workbook per month; the dashboard reads the "
        "resulting fact tables."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(hotels.router)
app.include_router(uploads.router)
app.include_router(dashboard.router)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Frontend
#
# Serving the built SPA from this process means the whole app lives on one
# origin and one port, so no proxy or CORS hop is needed in front of it.
# Registered last, so every API route and /docs still wins over the catch-all.
# --------------------------------------------------------------------------- #
dist = settings.frontend_dist

if settings.serve_frontend and dist.is_dir():
    app.mount(
        "/assets", StaticFiles(directory=dist / "assets"), name="assets"
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        """Return the requested file, or index.html for a client-side route."""
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(dist / "index.html")

else:
    logging.getLogger(__name__).info(
        "Frontend build not found at %s - serving the API only. "
        "Run 'npm run build' in frontend/ to serve the UI from this process.",
        dist,
    )
