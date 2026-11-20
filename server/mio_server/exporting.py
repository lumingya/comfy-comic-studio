"""Frozen, cancellable exports written to files through the existing job engine."""

from __future__ import annotations

import hashlib
import html
import io
import json
import re
import shutil
import stat
import tempfile
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

from PIL import Image

from .album import media as M
from .album import templates as T
from .album.build import episode_book
from .album.render import AlbumOptions
from .fs_paths import regular_path_metadata
from .jobs import ItemSpec, JobConflict
from .jobs.types import canonical
from .models import Episode, Series
from .pipeline import export as X
from .storage import NotFound

JOB_ID = re.compile(r"job_[0-9a-f]{1,60}")
JOB_FILE = re.compile(r"[0-9]{1,19}-[0-9]{1,19}\.(?:partial|bin)")


def contribution_ref(item):
    return {
        "point": item.point,
        "id": item.id,
        "source": item.source,
        "digest": item.meta.get("digest", ""),
        "contract": 1,
    }


def find_contribution(registry, point, identifier):
    items = registry.layers(point, identifier)
    if not items:
        raise ValueError(f"未找到 {point}: {identifier}")
    return items[-1]


class FrozenRegistry:
    """Resolve submitted layers, never whichever override happens to be current."""

    def __init__(self, registry, refs):
        self.values = {}
        for ref in refs:
            match = next(
                (
                    item
                    for item in registry.layers(ref["point"], ref["id"])
                    if item.source == ref["source"] and item.meta.get("digest", "") == ref["digest"]
                ),
                None,
            )
            if match is None:
                raise JobConflict(f"导出依赖已变更：{ref['point']}:{ref['id']}")
            self.values[ref["point"], ref["id"]] = match

    def get(self, point, identifier):
        return self.values[point, identifier].value


class FrozenStore:
    def __init__(self, store, snapshot):
        self.original = store
        self.episodes = {
            value["id"]: Episode.model_validate(value) for value in snapshot["episodes"]
        }
        self.series = {value["id"]: Series.model_validate(value) for value in snapshot["series"]}
        self.counts = snapshot["episode_counts"]
        self.lock = store.lock

    def get_episode(self, identifier):
        return self.episodes[identifier].model_copy(deep=True)

    def get_series(self, identifier):
        return self.series[identifier].model_copy(deep=True)

    def episode_summaries(self, identifier, *_args):
        return [], self.counts[identifier]

    def get_asset(self, identifier):
        return self.original.get_asset(identifier)


class ExportService:
    """One executor serves synchronous downloads and resumable background exports."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.root = ctx.data_dir.absolute() / "exports"
        self._regular_path(self.root, directory=True)
        self.root.mkdir(exist_ok=True)
        self._writing = set()

    @staticmethod
    def _regular_path(path, *, directory=False):
        """Reject links, Windows reparse points and non-regular output nodes."""
        attrs = regular_path_metadata(path, directory=directory, missing=True)
        if attrs is None:
            return
        if not directory and attrs.st_nlink > 1:
            raise ValueError("export path is not a regular owned path")

    def _job_folder(self, job_id, *, create=False):
        if not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id):
            raise NotFound("export job not found")
        self._regular_path(self.root, directory=True)
        folder = self.root / job_id
        self._regular_path(folder, directory=True)
        if folder.resolve().parent != self.root.resolve():
            raise ValueError("export directory escapes its root")
        if create:
            folder.mkdir(exist_ok=True)
            self._regular_path(folder, directory=True)
        return folder

    def _job_file(self, job_id, name):
        if not isinstance(name, str) or not JOB_FILE.fullmatch(name):
            raise NotFound("export file not found")
        path = self._job_folder(job_id) / name
        self._regular_path(path)
        return path

    def _unlink_output(self, path):
        """Cleanup must recheck ownership after cancellation or a writer failure."""
        try:
            self._regular_path(self.root, directory=True)
            if path.parent != self.root:
                if not self._owned_directory(path.parent):
                    return
            self._regular_path(path)
            path.unlink(missing_ok=True)
        except (OSError, ValueError):
            pass

    def _remove_download(self, folder):
        if folder.name.startswith("download-") and self._owned_directory(folder):
            shutil.rmtree(folder, ignore_errors=True)

    def freeze(self, kind, options, *, require_complete=False):
        ids = options.get("episode_ids") or [options["episode_id"]]
        with self.ctx.store.lock:
            episodes = [self.ctx.store.get_episode(eid) for eid in ids]
            series = {ep.series_id: self.ctx.store.get_series(ep.series_id) for ep in episodes}
            counts = {sid: self.ctx.store.episode_summaries(sid, 0, 1)[1] for sid in series}
        refs = [contribution_ref(find_contribution(self.ctx.registry, "layout", "strip.default"))]
        if require_complete:
            self._require_finished(episodes, series, options.get("variant_id"))
        snapshot = {
            "kind": kind,
            "options": dict(options),
            "episodes": [ep.model_dump(mode="json") for ep in episodes],
            "series": [value.model_dump(mode="json") for value in series.values()],
            "episode_counts": counts,
            "dependencies": refs,
        }
        if kind == "strip":
            if "preview_width" not in options:
                exporter = find_contribution(
                    self.ctx.registry, "exporter", options.get("fmt", "slices")
                )
                if exporter.meta.get("interface") != "strip":
                    raise ValueError("请选择条漫导出格式")
                refs.append(contribution_ref(exporter))
            preset = self.ctx.registry.get("slice_preset", options.get("preset", "webtoon"))
            snapshot["preset"] = asdict(X.with_quality(preset, options.get("quality")))
        elif kind == "album":
            refs.append(contribution_ref(find_contribution(self.ctx.registry, "exporter", "album")))
            template = options.get("template")
            template = (
                T.parse_template(template)
                if template
                else self.ctx.registry.get(
                    "album_template", options.get("template_id", "export-paper")
                )
            )
            snapshot["template"] = template.model_dump(mode="json")
        elif kind != "portable":
            raise ValueError("未知导出类型")
        if kind != "album" and not any(
            ep.adopted(p.id, options.get("variant_id")) for ep in episodes for p in ep.panels
        ):
            raise ValueError("没有可导出的格，请先采用图片")
        return snapshot

    def _require_finished(self, episodes, series, variant_id):
        for episode in episodes:
            if variant_id is not None and all(
                variant.id != variant_id for variant in series[episode.series_id].variants
            ):
                raise NotFound(f"variant not found: {variant_id}")
            adopted = {
                take.panel_id
                for take in episode.takes
                if take.variant_id == variant_id
                and take.status == "adopted"
                and self.ctx.assets.exists(take.asset_id)
            }
            if not episode.panels or any(panel.id not in adopted for panel in episode.panels):
                raise JobConflict("请先为该话的每个分幕采用图片")

    def submit(self, kind, options, idempotency_key=None, *, require_complete=False):
        engine = self.ctx.engine
        with engine.hold_operation():
            if idempotency_key:
                with engine.lock:
                    previous = engine.db.execute(
                        "SELECT id, kind, snapshot_json FROM jobs WHERE idempotency_key = ?",
                        (idempotency_key,),
                    ).fetchone()
                if previous:
                    frozen = json.loads(previous["snapshot_json"])
                    if (
                        previous["kind"] != "export.render"
                        or frozen.get("kind") != kind
                        or canonical(frozen.get("options")) != canonical(options)
                    ):
                        raise JobConflict("此请求标识已用于其他导出设置")
                    return engine.get(previous["id"])
            snapshot = (
                self.freeze(kind, options, require_complete=True)
                if require_complete
                else self.freeze(kind, options)
            )
            title = options.get("title") or snapshot["episodes"][0]["title"]
            return engine.submit(
                "export.render",
                [ItemSpec({}, label=title)],
                snapshot,
                title=f"导出 · {title}",
                idempotency_key=idempotency_key,
                owner=snapshot["episodes"][0]["id"],
            )

    def _owned_directory(self, folder):
        try:
            self._regular_path(self.root, directory=True)
            self._regular_path(folder, directory=True)
            attrs = folder.lstat()
            return (
                folder.parent.resolve() == self.root.resolve()
                and stat.S_ISDIR(attrs.st_mode)
                and not getattr(attrs, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
                and folder.resolve().parent == self.root.resolve()
            )
        except (OSError, ValueError):
            return False

    def cleanup_startup(self):
        """Run under the workspace lease, before starting any worker or download."""
        self._regular_path(self.root, directory=True)
        for folder in self.root.iterdir():
            if not self._owned_directory(folder):
                continue
            if folder.name.startswith("download-"):
                self._remove_download(folder)
            elif JOB_ID.fullmatch(folder.name):
                self._cleanup_job(folder.name)

    def _cleanup_job(self, job_id):
        folder = self._job_folder(job_id)
        if not self._owned_directory(folder):
            return
        engine = self.ctx.engine
        # Claims and result publication cannot race the reference check and unlink.
        with engine.hold_operation(), engine.lock:
            keep = set()
            rows = engine.db.execute(
                "SELECT result_json FROM job_items WHERE job_id = ? AND state = 'complete' "
                "UNION ALL SELECT result_json FROM job_deliveries "
                "WHERE job_id = ? AND state = 'pending'",
                (job_id, job_id),
            ).fetchall()
            for row in rows:
                if row["result_json"]:
                    keep.add(json.loads(row["result_json"]).get("file"))
            for (running_job, _), item in engine.running.items():
                if running_job == job_id:
                    keep.update(
                        f"{item.epoch}-{item.attempt}.{suffix}" for suffix in ("partial", "bin")
                    )
            for writing_job, stem in self._writing:
                if writing_job == job_id:
                    keep.update(f"{stem}.{suffix}" for suffix in ("partial", "bin"))
            for path in folder.iterdir():
                if path.name not in keep and JOB_FILE.fullmatch(path.name):
                    self._unlink_output(path)

    def _view(self, snapshot):
        return SimpleNamespace(
            store=FrozenStore(self.ctx.store, snapshot),
            assets=self.ctx.assets,
            registry=FrozenRegistry(self.ctx.registry, snapshot["dependencies"]),
        )

    def execute(self, item):
        if any(
            type(value) is not int or not 0 <= value < 2**63 for value in (item.epoch, item.attempt)
        ):
            raise ValueError("invalid export attempt identity")
        self._job_folder(item.job_id, create=True)
        partial = self._job_file(item.job_id, f"{item.epoch}-{item.attempt}.partial")
        final = self._job_file(item.job_id, f"{item.epoch}-{item.attempt}.bin")
        item.on_abort(lambda: self._unlink_output(final))
        writing = (item.job_id, final.stem)
        with self.ctx.engine.lock:
            self._writing.add(writing)
        try:
            self._cleanup_job(item.job_id)
            info = self.write(
                item.snapshot,
                partial,
                checkpoint=item.raise_if_cancelled,
                progress=lambda done, total: item.progress(value=done, max=total),
            )
            item.raise_if_cancelled()
            self._job_file(item.job_id, partial.name)
            self._job_file(item.job_id, final.name)
            partial.replace(final)
            item.raise_if_cancelled()
            info["file"] = final.name
            return info
        except BaseException:
            self._unlink_output(partial)
            self._unlink_output(final)
            raise
        finally:
            with self.ctx.engine.lock:
                self._writing.discard(writing)

    def write(self, snapshot, path, *, checkpoint=lambda: None, progress=lambda done, total: None):
        ctx = self._view(snapshot)
        kind, opts = snapshot["kind"], snapshot["options"]
        checkpoint()
        try:
            if kind == "strip":
                mime, filename = self._strip(ctx, snapshot, path, checkpoint, progress)
                headers = {}
            elif kind == "portable":
                mime, filename, headers = self._portable(ctx, opts, path, checkpoint, progress)
            else:
                mime, filename, headers = self._album(ctx, snapshot, path, checkpoint, progress)
            checkpoint()
            digest = hashlib.sha256()
            with Path(path).open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    checkpoint()
                    digest.update(chunk)
            for episode in snapshot["episodes"]:
                self.ctx.hooks.action(
                    "episode.exported",
                    {
                        "episode_id": episode["id"],
                        "fmt": opts.get("fmt") or opts.get("format") or kind,
                        "bytes": Path(path).stat().st_size,
                        "filename": filename,
                    },
                )
            return {
                "mime": mime,
                "filename": filename,
                "bytes": Path(path).stat().st_size,
                "sha256": digest.hexdigest(),
                "headers": headers,
            }
        except BaseException:
            self._unlink_output(Path(path))
            raise

    @staticmethod
    def _strip(ctx, snapshot, path, checkpoint, progress):
        from .pipeline.regions import prepare_snapshot

        opts = snapshot["options"]
        ep = ctx.store.get_episode(opts["episode_id"])
        series = ctx.store.get_series(ep.series_id)
        if "preview_width" in opts:
            from .pipeline.file_export import write_png

            with prepare_snapshot(
                ctx, series, ep, opts.get("variant_id"), checkpoint=checkpoint
            ) as plan:
                write_png(
                    plan,
                    path,
                    width=opts["preview_width"],
                    checkpoint=checkpoint,
                    progress=progress,
                )
                return "image/png", "strip.png"
        fmt = opts.get("fmt", "slices")
        exporter = ctx.registry.values["exporter", fmt]
        preset = X.SlicePreset(**snapshot["preset"])
        arguments = dict(
            preset_id=preset,
            title=f"{series.title}_{ep.title}",
            subtitle=ep.title,
            quality=opts.get("quality"),
        )
        writer = exporter.meta.get("file_writer")
        if callable(writer):
            with prepare_snapshot(
                ctx, series, ep, opts.get("variant_id"), checkpoint=checkpoint
            ) as plan:
                return writer(
                    plan, fmt, path=path, checkpoint=checkpoint, progress=progress, **arguments
                )
        # Old strip extensions still receive the documented full PIL canvas.
        from .pipeline.episode_strip import render_snapshot

        _, _, strip, image = render_snapshot(ctx, series, ep, opts.get("variant_id"))
        try:
            checkpoint()
            data, mime, filename = exporter.value(image, strip, fmt, **arguments)
            checkpoint()
            Path(path).write_bytes(data)
            progress(1, 1)
            return mime, filename
        finally:
            image.close()

    @staticmethod
    def _portable(ctx, opts, path, checkpoint, progress):
        import zipfile

        from .album.build import iter_episode_pages
        from .pipeline.file_export import write_pdf

        profile = opts.get("image_profile", "auto")
        profile = "clean" if profile in ("auto", "preview") else profile
        stats = M.Stats(profile)
        episodes = [ctx.store.get_episode(eid) for eid in opts["episode_ids"]]
        title = opts.get("title") or episodes[0].title
        safe = re.sub(r"[^\w-]", "_", title)[:60] or "album"
        total = sum(len(ep.panels) for ep in episodes)
        done = 0

        def pages():
            nonlocal done
            for n, ep in enumerate(episodes, 1):
                series = ctx.store.get_series(ep.series_id)
                for i, page in enumerate(
                    iter_episode_pages(
                        ctx,
                        series,
                        ep,
                        variant_id=opts.get("variant_id"),
                        lettered=opts.get("lettered", True),
                        deduplicate_captions=opts.get("deduplicate_captions", False),
                        profile=profile,
                        stats=stats,
                        checkpoint=checkpoint,
                    ),
                    1,
                ):
                    checkpoint()
                    done += 1
                    progress(done, total)
                    if page is not None:
                        yield n, i, page

        fmt = opts.get("format", "zip")
        if fmt == "pdf":

            def images():
                for _, _, page in pages():
                    with Image.open(io.BytesIO(page.data)) as image:
                        yield image

            write_pdf(
                images(), path, quality=85 if profile == "publish" else 95, checkpoint=checkpoint
            )
            mime = "application/pdf"
        else:
            manifest = {
                "title": title,
                "image_profile": profile,
                "books": [{"title": ep.title, "files": []} for ep in episodes],
            }
            figures = [[] for _ in episodes]
            with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as archive:
                for n, i, page in pages():
                    folder = f"images/{n:02d}" if len(episodes) > 1 else "images"
                    name = f"{folder}/{i:03d}.{M.ext_of(page.mime)}"
                    archive.writestr(name, page.data)
                    manifest["books"][n - 1]["files"].append(
                        {"name": name, "caption": page.caption}
                    )
                    caption = (
                        f"<figcaption>{html.escape(page.caption)}</figcaption>"
                        if opts.get("show_captions", True)
                        else ""
                    )
                    figures[n - 1].append(
                        f'<figure><img loading="lazy" src="{name}" alt="{html.escape(page.name)}">{caption}</figure>'
                    )
                archive.writestr(
                    "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2)
                )
                chapters = "".join(
                    f"<section><h2>{html.escape(ep.title)}</h2>{''.join(pages)}</section>"
                    if len(episodes) > 1
                    else "".join(pages)
                    for ep, pages in zip(episodes, figures)
                )
                archive.writestr(
                    "index.html",
                    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                    f"<title>{html.escape(title)}</title><style>body{{margin:0;background:#faf9f6;color:#28332b;font:16px/1.7 system-ui}}main{{max-width:1000px;margin:auto;padding:24px}}figure{{margin:0 0 24px}}img{{display:block;width:100%;height:auto}}</style><main><h1>{html.escape(title)}</h1>{chapters}</main></html>",
                )
            mime = "application/zip"
        return mime, f"{safe}.{fmt}", {"X-Mio-Export": stats.header()}

    @staticmethod
    def _album(ctx, snapshot, path, checkpoint, progress):
        opts = snapshot["options"]
        requested = opts.get("image_profile", "preview")
        profile = "clean" if requested == "auto" else requested

        def build(profile):
            stats = M.Stats(profile)
            books = []
            for i, eid in enumerate(opts["episode_ids"]):
                checkpoint()
                books.append(
                    episode_book(
                        ctx,
                        eid,
                        variant_id=opts.get("variant_id"),
                        lettered=opts.get("lettered", True),
                        deduplicate_captions=opts.get("deduplicate_captions", False),
                        profile=profile,
                        max_width=opts.get("max_width", 1400),
                        stats=stats,
                        checkpoint=checkpoint,
                    )
                )
                progress(i + 1, len(opts["episode_ids"]))
            return books, stats

        books, stats = build(profile)
        if requested == "auto" and M.over_budget(stats):
            books, stats = build("publish")
            stats.auto_compressed = True
        stats.over_budget = M.over_budget(stats)
        checkpoint()
        tpl = T.AlbumTemplate.model_validate(snapshot["template"])
        document = ctx.registry.get("exporter", "album")(
            tpl,
            books,
            AlbumOptions(
                show_captions=opts.get("show_captions", True),
                show_prompts=opts.get("show_prompts", False),
                border=opts.get("border", 0),
                signature=opts.get("signature", ""),
                theme_color=opts.get("theme_color", ""),
                collection_title=opts.get("title", ""),
            ),
        )
        Path(path).write_text(document, encoding="utf-8")
        title = opts.get("title") or books[0].title
        return "text/html", f"{title}_{tpl.id}.html", {"X-Mio-Export": stats.header()}

    def result(self, job_id):
        self._job_folder(job_id)
        job = self.ctx.engine.get(job_id)
        if job["kind"] != "export.render":
            raise NotFound("不是导出任务")
        if job["state"] != "completed":
            raise JobConflict("导出尚未完成")
        result = job["items"][0].get("result") or {}
        if not isinstance(result, dict):
            raise NotFound("导出文件不存在")
        name = result.get("file", "")
        if not isinstance(name, str) or not JOB_FILE.fullmatch(name) or not name.endswith(".bin"):
            raise NotFound("导出文件不存在")
        path = self._job_file(job_id, name)
        if not path.is_file():
            raise NotFound("导出文件不存在，请重试导出任务")
        return path, result

    def remove(self, job_id):
        folder = self._job_folder(job_id)
        if self._owned_directory(folder):
            shutil.rmtree(folder, ignore_errors=True)

    def response(self, kind, options):
        from fastapi.responses import FileResponse
        from starlette.background import BackgroundTask

        self._regular_path(self.root, directory=True)
        folder = Path(tempfile.mkdtemp(prefix="download-", dir=self.root))
        try:
            path = folder / "export.bin"
            info = self.write(self.freeze(kind, options), path)
            return FileResponse(
                path,
                media_type=info["mime"],
                filename=info["filename"],
                headers={
                    **info["headers"],
                    "Content-Disposition": f"attachment; filename*=UTF-8''{quote(info['filename'])}",
                },
                background=BackgroundTask(self._remove_download, folder),
            )
        except BaseException:
            self._remove_download(folder)
            raise
