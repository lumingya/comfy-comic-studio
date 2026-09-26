from __future__ import annotations

import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Response, status

from .assistant import ScriptRequest, plan_episode
from .export import StripExport, export_manifest
from .models import Episode, EpisodeCreate, Series, SeriesCreate
from .package_io import build_package
from .storage import NotFound, SQLiteStore


def default_db_path() -> Path:
    return Path(os.environ.get("MIO_V3_DB", "data/runtime/mio-v3.sqlite3"))


def create_app(store: SQLiteStore | None = None) -> FastAPI:
    app = FastAPI(title="Mio v3 API", version="0.2.0")
    app.state.store = store or SQLiteStore(default_db_path())

    def get_store() -> SQLiteStore:
        return app.state.store

    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True, "schema": 2}

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

    @app.put("/api/series/{series_id}", response_model=Series)
    def save_series(series_id: str, payload: Series, store: SQLiteStore = Depends(get_store)) -> Series:
        if payload.id != series_id:
            raise HTTPException(status_code=400, detail="series id mismatch")
        try:
            return store.save_series(payload)
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.delete("/api/series/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_series(series_id: str, store: SQLiteStore = Depends(get_store)) -> None:
        try:
            store.delete_series(series_id, soft=True)
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/trash/series", response_model=list[Series])
    def list_trash(store: SQLiteStore = Depends(get_store)) -> list[Series]:
        return store.list_deleted_series()

    @app.post("/api/trash/series/{series_id}/restore", response_model=Series)
    def restore_series(series_id: str, store: SQLiteStore = Depends(get_store)) -> Series:
        try:
            return store.restore_series(series_id)
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

    @app.get("/api/episodes/{episode_id}", response_model=Episode)
    def get_episode(episode_id: str, store: SQLiteStore = Depends(get_store)) -> Episode:
        try:
            return store.get_episode(episode_id)
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.put("/api/episodes/{episode_id}", response_model=Episode)
    def save_episode(episode_id: str, payload: Episode, store: SQLiteStore = Depends(get_store)) -> Episode:
        if payload.id != episode_id:
            raise HTTPException(status_code=400, detail="episode id mismatch")
        try:
            return store.save_episode(payload)
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/series/{series_id}/assistant/script")
    def assistant_script(series_id: str, payload: ScriptRequest, store: SQLiteStore = Depends(get_store)) -> dict:
        try:
            series = store.get_series(series_id)
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        diff = plan_episode(series_id, f"{series.title} · 初稿", payload)
        episode = store.create_episode(diff.episode)
        return {"summary": diff.summary, "episode": episode, "diff": {"added_panels": [p.model_dump() for p in diff.added_panels]}}

    @app.post("/api/episodes/{episode_id}/variants", response_model=list[Episode])
    def create_variants(episode_id: str, names: list[str], store: SQLiteStore = Depends(get_store)) -> list[Episode]:
        try:
            base = store.get_episode(episode_id)
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        created = []
        for i, name in enumerate(names):
            clone = base.model_copy(deep=True)
            clone.id = f"{base.id}_variant_{i + 1}"
            clone.title = f"{base.title} · {name}"
            clone.order = base.order + i + 1
            created.append(store.create_episode(clone))
        return created

    @app.get("/api/episodes/{episode_id}/export/strip", response_model=StripExport)
    def export_strip(episode_id: str, store: SQLiteStore = Depends(get_store)) -> StripExport:
        try:
            return export_manifest(store.get_episode(episode_id))
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/series/{series_id}/package")
    def package_series(series_id: str, store: SQLiteStore = Depends(get_store)) -> Response:
        try:
            series = store.get_series(series_id)
            episodes = store.list_episodes(series_id)
        except NotFound as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        data = build_package(series, episodes)
        return Response(content=data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{series_id}.mio.zip"'})

    return app


app = create_app()
