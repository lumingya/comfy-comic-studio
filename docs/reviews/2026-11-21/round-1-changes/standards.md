# 第一轮 Standards 审查

范围固定为 `git diff 6aa0f8f...125e07f`；实测时 HEAD 为 `125e07f`。规范来源：`AGENTS.md`、`README.md`、`docs/ROADMAP.md`；核对了 CI 和共享台账。未用既有测试通过记录替代当前证据。

## 确认行为

### S1 · P2：设定集单独修改可绕过陈旧提案检查，并被未展示的旧值覆盖

- **位置**：`server/mio_server/pipeline/assistant.py:283–306,334`；新入口 `examples/extensions/script-review/panel.js:183–200`。
- **规范**：路线图 §7 Wave 2（第 241 行）承诺逐字段 Diff、逐条接受/拒绝与陈旧提案拦截；§2.1 要求手工接管。`assistant` 模块也声明只写接受的修改。
- **触发**：提案只修改角色名字；审阅期间另一窗口单独修改该角色的标签；保持话修订号不变后接受名字修改。
- **预期 / 实际**：标签应保留，或检测设定集冲突。实际提案与界面只检查话修订号；`_character_patch` 写入整个旧 `after`，成功把没有出现在 Diff 中的作者标签恢复为旧值。内存 SQLite 实测输出见下方。场景修改同样写全量字段。
- **影响 / 最小修法**：正常审阅会静默丢失设定集编辑。在同一事务中核对受改字段的旧值（或携带设定集版本），并只写 `changes` 指定字段；冲突返回 409。
- **覆盖缺口 / 归属**：新增测试只覆盖话修订冲突与事务回滚，未覆盖独立的设定集变化。全量 `after` 写法在基线已存在；这是新增审阅包及本轮承诺暴露的既有能力缺口，**不称为本轮新引入的回归**，由主控决定纳入原范围或相邻模块修复。已通知主控，尚未修复。

## 覆盖与边界

后端槽位、主题包和渲染拆分的公开业务入口、仓内导入和函数主体未发现缺失；不把内部依赖别名或 monkeypatch 路径当兼容承诺。另将基线槽位模块从 Git 源码载入内存，独立比较 113 份契约/v3/拓扑输入的 `analyze`（去时间戳）与 `apply` 结果或异常：零差异。检查新增媒体/宿主槽位契约、专业包注册方式及 CI 变更，未确认厂商分支回流核心、无条件专业入口或可操作的架构异味。

没有重复全量门禁、运行浏览器、安装依赖、访问真实服务或读取个人运行数据。媒体会话安全、持久发布及生态/SDK 的深入攻击由其他独立审查者负责；本报告不证明 276 文件无缺陷。

## S1 最短离线复现

仓库根目录执行以下 Python，`server/` 加入 `sys.path`；只使用内存数据库：

```python
import sys
sys.path.insert(0, "server")
from mio_server.models import Bible, Character, Episode, Panel, PanelCharacter, Series
from mio_server.pipeline import assistant as A
from mio_server.storage import SQLiteStore

store = SQLiteStore(":memory:")
try:
    series = Series(id="review_series", title="Neutral", bible=Bible(characters=[
        Character(id="character", name="Original", age=26, tag_description=["initial"])
    ]))
    episode = Episode(id="review_episode", series_id=series.id, title="Neutral", order=0,
        panels=[Panel(id="panel", order=0,
            characters=[PanelCharacter(character_id="character")])])
    store.create_series(series)
    store.create_episode(episode)
    revised = A.normalized_view(series, episode)
    revised["characters"][0]["name"] = "Proposed"
    ops = A.diff(series, episode, revised)
    assert ops[0]["changes"] == {"name": ["Original", "Proposed"]}
    store.update_series(series.id, lambda s: setattr(
        s.bible.characters[0], "tag_description", ["author edit"]))
    result = A.apply(store, episode.id, ops, [ops[0]["id"]], episode.revision)
    print(result)
    print(store.get_series(series.id).bible.characters[0].tag_description)
finally:
    store.close()
```

实测输出：`{'applied': ['op1'], 'revision': 1}`，标签为 `['initial']`，而非作者保存的 `['author edit']`。
