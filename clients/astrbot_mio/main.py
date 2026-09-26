"""AstrBot plugin: drive Mio Comic Studio from chat through the open API (``/api/v2``).

Install: copy this folder into AstrBot's ``data/plugins/`` and fill in the plugin config:

* ``base_url`` – where Mio runs, e.g. ``http://127.0.0.1:8788``.
* ``token`` – create one in Mio → Settings → API with scopes ``read``, ``write`` and ``render``.
* ``allowed_ids`` – sender ids allowed to start renders (empty = AstrBot admins only).

Commands::

    /mio 画 <一句话>   script, render, adopt and send the strip (costs GPU / API credits)
    /mio 任务          jobs in progress
    /mio 作品          list series
    /mio 帮助
"""

from __future__ import annotations

import asyncio
import os
import tempfile

import astrbot.api.message_components as Comp
from astrbot.api import AstrBotConfig, logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Context, Star, register

from .flow import MioClient, MioError, draw, job_summary, series_list

HELP = (
    "Mio 漫画工作室\n"
    "/mio 画 <一句话> — 生成剧本并出图，发回整条漫画\n"
    "/mio 任务 — 查看进行中的任务\n"
    "/mio 作品 — 作品列表"
)


@register("astrbot_plugin_mio", "Mio", "Mio 漫画工作室：一句话出条漫", "4.0.0")
class MioPlugin(Star):
    def __init__(self, context: Context, config: AstrBotConfig):
        super().__init__(context)
        self.config = config
        self.busy: set[str] = set()

    def client(self) -> MioClient:
        return MioClient(
            self.config.get("base_url", "http://127.0.0.1:8788"),
            token=self.config.get("token", ""),
            timeout=float(self.config.get("timeout", 300)),
        )

    def allowed(self, event: AstrMessageEvent) -> bool:
        ids = [str(i) for i in self.config.get("allowed_ids", []) or []]
        if ids:
            return str(event.get_sender_id()) in ids
        return event.is_admin()

    @filter.command_group("mio")
    def mio(self):
        pass

    @mio.command("帮助")
    async def help(self, event: AstrMessageEvent):
        yield event.plain_result(HELP)

    @mio.command("任务")
    async def jobs(self, event: AstrMessageEvent):
        try:
            yield event.plain_result(await asyncio.to_thread(job_summary, self.client()))
        except (MioError, OSError) as exc:
            yield event.plain_result(f"连接 Mio 失败：{exc}")

    @mio.command("作品")
    async def works(self, event: AstrMessageEvent):
        try:
            yield event.plain_result(await asyncio.to_thread(series_list, self.client()))
        except (MioError, OSError) as exc:
            yield event.plain_result(f"连接 Mio 失败：{exc}")

    @mio.command("画")
    async def draw_cmd(self, event: AstrMessageEvent):
        sentence = event.message_str.split("画", 1)[-1].strip()
        if not sentence:
            yield event.plain_result("用法：/mio 画 <一句话>")
            return
        if not self.allowed(event):
            yield event.plain_result("出图会消耗算力或额度，只有授权用户可以使用。")
            return
        sender = str(event.get_sender_id())
        if sender in self.busy:
            yield event.plain_result("你的上一话还在画，请稍等。")
            return
        self.busy.add(sender)
        try:
            yield event.plain_result(f"收到：「{sentence}」，开始写剧本…")
            notes: list[str] = []
            episode, png = await asyncio.to_thread(
                draw,
                self.client(),
                sentence,
                series_title=self.config.get("series_title", "机器人作品"),
                candidates=int(self.config.get("candidates", 1)),
                width=int(self.config.get("strip_width", 720)),
                timeout=float(self.config.get("render_timeout", 1800)),
                progress=notes.append,
            )
            for note in notes:
                yield event.plain_result(note)
            path = os.path.join(tempfile.gettempdir(), f"mio_{episode['id']}.png")
            with open(path, "wb") as fh:
                fh.write(png)
            yield event.chain_result(
                [Comp.Plain(f"《{episode['title']}》完成"), Comp.Image.fromFileSystem(path)]
            )
        except MioError as exc:
            logger.warning("mio draw failed: %s", exc)
            yield event.plain_result(f"失败：{exc.detail}")
        except (OSError, TimeoutError) as exc:
            yield event.plain_result(f"连接 Mio 失败：{exc}")
        finally:
            self.busy.discard(sender)
