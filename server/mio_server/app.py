from __future__ import annotations

import os
from pathlib import Path
from fastapi import Depends, FastAPI, HTTPException, status

from .models import Episode, EpisodeCreate, Series, SeriesCreate
from .storage import NotFound, SQLiteStore


def default_db_path() -> Path:
    return Path(os.environ.get("MIO_V3_DB", "data/runtime/mio-v3.sqlite3"))


def create_app(store: SQLiteStore | None = None) -> FastAPI:
    app = FastAPI(title="Mio v3 API", version="0.1.0")
    app.state.store = store or SQLiteStore(default_db_path())

    def get_store() -> SQLiteStore:
        return app.state.store

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True, "schema": 1}

    @app.get("/api/series", response_model=list[Series])
    def list_series(store: SQLiteStore = Depends(get_store)) -> list[Series]:
        return store.list_series()

    @app.post("/api/series", response_model=Series, status_code=status.HTTP_201_CREATED)
    def create_series(payload: SeriesCreate, store: SQLiteStore = Depends(get_store)) -> Series:
        return store.create_series(Series(title=payload.title, subtitle=payload.subtitle))

    @app.get("/api/series/{series_id}", response_model=Series)
    def get_series(series_id: str, store: SQLiteStore = Depends(get_store)) -> Series:
        try:
            return store.get_series(series_id)
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.delete("/api/series/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_series(series_id: str, store: SQLiteStore = Depends(get_store)) -> None:
        try:
            store.delete_series(series_id)
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/series/{series_id}/episodes", response_model=list[Episode])
    def list_episodes(series_id: str, store: SQLiteStore = Depends(get_store)) -> list[Episode]:
        try:
            return store.list_episodes(series_id)
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/series/{series_id}/episodes", response_model=Episode, status_code=status.HTTP_201_CREATED)
    def create_episode(series_id: str, payload: EpisodeCreate, store: SQLiteStore = Depends(get_store)) -> Episode:
        try:
            return store.create_episode(Episode(series_id=series_id, title=payload.title, order=payload.order))
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return app


app = create_app()
