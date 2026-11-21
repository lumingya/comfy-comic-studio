# 第三轮：备份、更新与扩展安装生命周期

- 审查基线：`ddf8d81f5a8d3b624da9618718599374de2f61f6`。
- 审查轴：需求/行为与错误恢复。未把可维护性异味、格式检查或旧台账已关闭项重复记为缺陷。
- 本报告确认 6 项：更新生命周期 3 项、扩展生命周期 2 项、备份 UI/后端大小边界 1 项。核心工作区备份的下列抽样路径未发现新缺陷；这不表示全仓无缺陷。
- 所有新探针仅使用 `tempfile.TemporaryDirectory()` 下完整受控的程序、工作区、扩展、签名清单与 ZIP。签名密钥在内存临时生成且未输出。无真实网络、依赖安装、发布、服务重启，也未读取真实备份或密钥。探针退出后临时目录清理。
- 仅新增本报告；未修改源码、测试或共享台账，未提交或推送。

## 实际覆盖与约束

| 路径 | 实际检查边界 |
| --- | --- |
| `server/mio_server/backups/service.py` | 导出、暂存、head/hash 确认、保护备份、安排、取消及记录清理的实现阅读；成功与版本漂移由针对性现有测试验证 |
| `server/mio_server/backups/snapshot.py` | quiescent 锁顺序、数据库快照、私有设置与素材复制、最终清单校验 |
| `server/mio_server/backups/startup.py`、`paths.py` | 租约、目录交换与日志阶段、两次目录移动中断、回滚中断、启动成功确认 |
| `server/mio_server/backups/archive.py`、`privacy.py` | ZIP 范围/清单/哈希、默认凭据脱敏、导入前数据库与素材闭包验证的调用关系；未重审已改的数据库验证器 |
| `server/mio_server/backups/participants.py`、`extension_data.py`、`ui_data.py` | 已审阅数据契约、宿主保留设置、私有偏好、head、恢复后数据参与者保留；通过现有临时夹具验证外部契约与偏好恢复 |
| `server/mio_server/update/updater.py`、`manifest.py`、`catalog.py`、`__main__.py` | 签名包暂存、重新校验、程序替换、回滚、启动参数、双实例交错和进程终止边界；所有包为自制合法测试签名包 |
| `server/mio_server/extensions/manager.py`、`trust.py` | install/enable/replace/remove 的状态顺序、激活失败回退、可信包快照发布；实测覆盖最终发布失败与可信快照失败 |
| `server/mio_server/extensions/dependencies.py` | 声明解析、环境闭包、dry-run 固定计划、共享版本约束和前后环境核对；仅执行已有 mock pip 的两项窄测试，未真正安装包 |
| `server/mio_server/extensions/marketplace.py`、`http.py` | 来源/目录摘要、包 SHA、包身份到统一安装器的调用与有界 body helper 阅读；未访问目录服务器或发 HTTP 请求 |
| `start.bat`、`start.sh`、`context.py`、`api/update.py` | 仅追踪启动器参数到 Updater 数据目录、程序安装到上下文租约的集成顺序；非这些文件逐行全覆盖 |
| `web/src/api/backups.ts:11`、`web/src/pages/settings/BackupsSection.tsx:326-335`、`server/mio_server/api/backups.py:29-41` | 应主控追加要求，仅复核前后端大小常量与实际选择回调；执行纯文件元数据探针，没有生成 GB 文件 |

已读 `AGENTS.md`、`README.md`、路线图、CI、共享审查 README/台账，以及备份/扩展市场/扩展备份契约说明。优先模块均不在 `git diff --name-only 6aa0f8f...ddf8d81` 的源文件列表中。`context.py` 等已改文件仅为调用关系证据，不再次审计 assets/database/publication 已关闭项。

未覆盖：真实远程发布/市场服务，真实 pip/安装脚本副作用，真实用户服务运行期间更新，断电/磁盘故障耐久性，Windows junction/链接新攻击矩阵，超大包资源耗尽，恶意 SQLite 新语料、主题媒体新格式、所有第三方参与者，以及完整启动器联网安装/E2E。未运行全量门禁。

## 已确认发现

### R3-LIFE-01 · P1 · 更新缺少跨实例/进程安装租约，双启动可清除 pending 后留下混合版本

- 位置：`server/mio_server/update/updater.py:54-63, 379-411`。`serialized` 只使用各自 Updater 实例的 `threading.RLock`；两个实例共用 `apply-verified`、安装目录和 `pending.json`，但没有共享 OS 租约。`start.bat:27` / `start.sh:17` 在主上下文的工作区租约建立前运行此安装器。
- 触发：同一发行目录与数据目录有已暂存的合法签名包；用户重复启动，两个启动器同时应用它。受控夹具在 A 已将旧 `server/mio_server` 移入其 backup、尚未将新模块移入当前位置时暂停 A，让 B 完整执行，再恢复 A。
- 预期：最多一个安装器进入程序替换；第二个等待后重新读取 pending 或明确拒绝。已返回成功的安装不能再被另一个失败安装器部分回滚。
- 实际：B 成功并删除 pending、`apply-verified`；A 恢复后源文件不复存在，触发 `FileNotFoundError`，仅回滚 A 自己已记录的模块。最终新 `start.sh` 搭配旧 `server/mio_server`，且没有待安装记录。
- 实测输出：`{"calls":{"B":"success","A":"FileNotFoundError"},"module":"__version__=\"4.0.0\"","launcher":"new-launcher","pending":null,"old_file_restored":true}`。
- 影响：正常双启动可产生不可追踪的混合程序/依赖状态；下一次启动没有 pending 可重新应用。无需伪造签名或修改包。
- 最小修补：在读取 pending 及任何解压/替换之前取得**安装根级** OS 独占租约，覆盖校验、替换、回滚、pending 清理整个过程；拿到租约后再读 pending。仅按 workspace 互斥不足以保护多个工作区共用同一程序安装根。临时验证目录也应为本次安装独有。

### R3-LIFE-02 · P1 · 更新进程在移动主包后中断，会同时移走下一次启动所需的恢复器

- 位置：`server/mio_server/update/updater.py:383-411`，尤其 `389-393`；启动入口 `start.bat:23-29`、`start.sh:13-18`，恢复器在 `server/mio_server/update/__main__.py`。
- 触发：合法签名包应用过程中，旧 `server/mio_server` 已移动到 backup，但新模块尚未移动到安装位置时，进程终止。探针在真实 `shutil.move` 完成该移动后抛 `ProcessLost(BaseException)`，模拟不可被 `except Exception` 捕获的进程退出；未终止真实进程。
- 预期：重启能够重放安装日志或恢复旧程序，至少保留一个不受正在替换模块影响的启动恢复入口。
- 实际：移动清单只有内存 `moved`，没有持久阶段日志；`server/mio_server` 目录不存在。旧目录仍在 backup、pending 仍在，但恢复代码也随旧目录一起移走。随后以临时 `install/server` 为 cwd，真实执行当前解释器 `-m mio_server.update status` 得到 `exit=1` 且 `ModuleNotFoundError`，启动器无法导入安装器来重试。
- 实测输出：`{"module_directory_exists":false,"pending":true,"old_backups":1,"next_start_import_exit":1,"module_not_found":true}`。
- 影响：关闭启动终端、进程崩溃或系统重启恰遇目录交换窗口，会使正式安装无法通过正常启动脚本自愈。旧代码虽在磁盘，必须手工找回；与 R3-LIFE-01 的并发问题独立。
- 最小修补：为程序替换建立持久意图/阶段日志；将重放/回滚入口放到不会在同一事务中被移走的位置，并由启动器先运行。仅把 `except Exception` 改成 `BaseException` 不能处理进程被杀/重启，也不能恢复丢失的导入入口。

### R3-LIFE-03 · P2 · 启动器不把 `--data` 传给更新器，自定义工作区的签名更新永远保持待安装

- 位置：`start.bat:27-29`、`start.sh:17-18`；`server/mio_server/update/__main__.py:24-27`；实际暂存目录来源为 `context.py:188` 与 `updater.py:80`。
- 触发：按 README 支持的方式用 `start.bat --data X` 或 `./start.sh --data X` 运行，在该工作区安排更新，再以相同命令启动。未设置 `MIO_V3_DATA`，或其值与 X 不同。
- 预期：启动前更新器检查与主应用相同的 X/updates。
- 实际：用户参数仅传给最终 `mio_server`；更新器命令只收到 `apply --prepare-dependencies`，因此检查默认数据目录。启动过程成功返回、应用仍为旧版、X 中 pending 不变。
- 实测：在 TEMP 建立旧 4.0.0 程序与 `chosen-workspace`，用合法签名包 stage 4.1.0。patch CLI 的安装根和默认数据目录到同一 TEMP 中两处受控目录；`main(['apply'])` 返回 0，`custom_pending=true`、仍 4.0.0；接着 `main(['apply','--data', X])` 返回 0，pending 清除且变成 4.1.0。未运行 bootstrap 或安装任何依赖。
- 影响：使用文档正式支持的自定义工作区时，应用内升级/回退完成下载与暂存后始终不安装；界面要求重启的行为无效。
- 最小修补：在一个共享启动参数解析入口解析并把 `--data X` / `--data=X` 转发给更新安装器，保持环境变量默认语义一致；不要直接把所有 server 参数传给目前只接受少数参数的更新器。

### R3-LIFE-04 · P2 · 覆盖扩展先删旧包，最终 rename 失败后连新暂存包也被清理

- 位置：`server/mio_server/extensions/manager.py:636-648`，关键为 `unload` → `shutil.rmtree(target)` → `staging.rename(target)`，异常 `finally` 又删除 staging。
- 触发：已安装且启用的用户扩展通过一个有效 ZIP 进行 replace；解压与清单校验均成功，最终目录发布遇到 `OSError`（例如目录锁、权限变化或防病毒拦截）。探针仅对 `.staging-demo` 最终 `Path.rename` 注入 `OSError`，其余文件读写和 manager 操作真实执行。
- 预期：返回安装失败且保留/恢复原有包与原激活状态，至少不能删除用户唯一的旧扩展文件。
- 实际：旧包已被卸载和递归删除，rename 失败；finally 清理新 staging。持久扩展设置仍是 `enabled=true`，但原包、新包与已加载实例都没有。私有 settings 尚存，这不挽回扩展程序文件。
- 实测输出：`{"original_folder_exists":false,"original_custom_file_exists":false,"loaded":false,"staging_retained":false,"private_data":{"value":"keep-private-data"},"settings_enabled":true}`。旧包中探针专设的 `custom_original.txt` 是唯一原件，确认实际删除而非仅注册表变化。
- 影响：一次正常覆盖安装失败会丢失旧扩展和未分发的本地定制，且设置与运行状态不一致。市场更新同样复用此安装器。
- 最小修补：先把旧 target 重命名到受控备份位置，再发布 staging；任一步失败时恢复原目录和状态，成功后才移除旧目录。为中断恢复保留明确状态，避免 finally 无条件删除仅剩的可恢复内容；私有数据区域保持独立。

### R3-LIFE-05 · P2 · 可信快照写入失败未进入 enable 回滚，API 失败后扩展仍 active

- 位置：`server/mio_server/extensions/manager.py:254-265`，以及 `extensions/trust.py:17-35`。
- 触发：扩展内容摘要正确、`load()` 成功，之后写恢复目录中的审阅快照或索引时发生 `OSError`（例如恢复目录磁盘满或写权限失败）。probe 只让 `remember_package` 抛该异常，没有运行不可信用户代码；临时扩展 activation 仅写一项受控 SDK settings 作为已执行证据。
- 预期：enable 向调用者失败时不留下新激活/启用状态，或者在所有可失败的可信快照准备完成后再发布激活结果。
- 实际：仅 `self.load()` 位于回滚 try 内，`remember_package()` 位于其后。异常向上传播，但 `loaded`、贡献/服务与持久 enabled 已经发布，原状态没有恢复。
- 实测输出：`{"status":"active","settings_enabled":true,"activation_ran":true}`，与抛出的 `OSError` 同时成立。
- 影响：用户收到启用失败却已有扩展代码/服务运行，且其备份规则的可信快照未建立或未完整写入。后者是契约落空，不在本报告额外宣称已实测私有数据丢失。该问题不等同于绕过用户摘要确认：用户已确认，只是错误后的状态与结果不一致。
- 最小修补：在激活状态发布前完成可校验的审阅快照与原子索引提交；或把这一步纳入可恢复前一加载实例/持久状态的完整回滚边界。不要仅吞掉错误并伪报启用成功。

### R3-LIFE-06 · P2 · 恢复选择器仍限制 2 GiB，拒绝后端允许的 2–12 GiB 工作区备份

- 位置：`web/src/api/backups.ts:11`、`web/src/pages/settings/BackupsSection.tsx:326-335`；后端范围为 `server/mio_server/backups/archive.py:24,59-60,205-206` 与 `server/mio_server/api/backups.py:29-41`。
- 触发：用户选择一个大小在 `(2 GiB, 12 GiB]` 内的备份。路线图/备份说明与后端均已把 ZIP 上限扩大到 12 GiB，后端自身也能导出该范围文件。
- 预期：设置页能够把该范围内的备份送到后端预检，实际格式与完整性由后端决定。
- 实际：前端上限仍为 `2 * 1024 ** 3`；FilePick 的实际 onFile 回调直接清空 file 并显示大小错误，因此没有机会预检/暂存。既有 UI 测试也固定断言“不能超过 2 GiB”，所以普通回归不能发现产品范围漂移。
- 实证：使用 Node 从当前 TSX 提取实际 onFile 回调，以只有 name/size 的对象执行；没有创建文件 payload。`size=2147483648` 时允许；`size=2147483649` 和 `12884901888` 时前端均拒绝，实际后端大小谓词 `size > 12 * 1024**3` 均为 false。输出：`{"frontGiB":2,"backGiB":12,"results":[{"size":2147483648,"frontendRejected":false,"backendSizeRejected":false},{"size":2147483649,"frontendRejected":true,"backendSizeRejected":false},{"size":12884901888,"frontendRejected":true,"backendSizeRejected":false}]}`。
- 影响：合法大小的工作区备份可以从本产品导出，却不能通过本产品的设置恢复入口导入；只能改用 API/CLI。这里确认的是前置大小拦截错误，不宣称已创建并校验 12 GiB 实体包。
- 最小修补：统一前后端 12 GiB 常量/展示文本，增加 2 GiB+1、12 GiB、12 GiB+1 的元数据边界测试；不需要为此分配 GB 级文件。

## 最短离线复现框架

以下片段均在仓库根使用已有 `.venv` 解释器执行；只导入源代码，所有运行数据在 TEMP。`make_update` 直接放入签名包并调用真实 `stage()`，跳过网络下载但没有跳过 apply 时的签名和 SHA 复核。

```python
import hashlib, io, json, os, subprocess, sys, tempfile, threading, zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path.cwd() / 'server'))
from mio_server.update import Updater, ed25519, sign_manifest, verify_manifest
from mio_server.update.manifest import key_id
from mio_server.update import updater as U, __main__ as CLI

secret, public = ed25519.generate()
keys = {key_id(public.hex()): public.hex()}

def make_update(base):
    root, data = base / 'install', base / 'chosen-workspace'
    module = root / 'server/mio_server'
    module.mkdir(parents=True)
    (module / '__init__.py').write_text('__version__="4.0.0"\n')
    (module / 'old_only.py').write_text('old')
    (root / 'start.sh').write_text('old-launcher')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('pkg/server/mio_server/__init__.py', '__version__="4.1.0"\n')
        z.writestr('pkg/start.sh', 'new-launcher')
    raw = buf.getvalue()
    signed = sign_manifest({'version': '4.1.0', 'package': {
        'name': 'test.zip', 'url': 'https://example.invalid/test.zip',
        'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
    }}, secret)
    up = Updater(data, root, current='4.0.0', keys=keys)
    up.manifest = verify_manifest(json.dumps(signed).encode(), keys)
    up.dir.mkdir(parents=True)
    (up.dir / 'test.zip').write_bytes(raw)
    up.stage()
    return up
```

R3-LIFE-01：

```python
with tempfile.TemporaryDirectory() as td:
    a = make_update(Path(td))
    b = Updater(a.dir.parent, a.root, current='4.0.0', keys=keys)
    target = a.root / 'server/mio_server'
    paused, resume, result = threading.Event(), threading.Event(), {}
    move = U.shutil.move
    def controlled_move(src, dst, *args, **kw):
        value = move(src, dst, *args, **kw)
        if threading.current_thread().name == 'launch-A' and Path(src) == target:
            paused.set()
            assert resume.wait(10)
        return value
    def first():
        try:
            a.apply_pending()
            result['A'] = 'success'
        except Exception as exc:
            result['A'] = type(exc).__name__
    with patch.object(U.shutil, 'move', side_effect=controlled_move):
        thread = threading.Thread(target=first, name='launch-A')
        thread.start()
        assert paused.wait(10)
        try:
            b.apply_pending()
            result['B'] = 'success'
        finally:
            resume.set()
        thread.join(10)
        assert not thread.is_alive()
    print(result, (target / '__init__.py').read_text(),
          (a.root / 'start.sh').read_text(), a.pending())
```

R3-LIFE-02：

```python
with tempfile.TemporaryDirectory() as td:
    up = make_update(Path(td))
    move = U.shutil.move
    class ProcessLost(BaseException): pass
    def interrupted(src, dst, *args, **kw):
        value = move(src, dst, *args, **kw)
        if Path(src) == up.root / 'server/mio_server':
            raise ProcessLost()
        return value
    with patch.object(U.shutil, 'move', side_effect=interrupted):
        try:
            up.apply_pending()
        except ProcessLost:
            pass
    env = {key: value for key, value in os.environ.items() if key != 'PYTHONPATH'}
    probe = subprocess.run([sys.executable, '-m', 'mio_server.update', 'status'],
        cwd=up.root / 'server', env=env, capture_output=True, text=True)
    print((up.root / 'server/mio_server').exists(), bool(up.pending()),
          probe.returncode, 'ModuleNotFoundError' in probe.stderr)
```

R3-LIFE-03：

```python
with tempfile.TemporaryDirectory() as td:
    up = make_update(Path(td))
    with patch.object(CLI, 'INSTALL_ROOT', up.root), \
         patch.object(CLI, 'default_data_dir', return_value=Path(td) / 'default'), \
         patch.object(U, 'TRUSTED_KEYS', keys):
        assert CLI.main(['apply']) == 0
        assert up.pending() is not None
        assert '4.0.0' in (up.root / 'server/mio_server/__init__.py').read_text()
        assert CLI.main(['apply', '--data', str(up.dir.parent)]) == 0
        assert up.pending() is None
        assert '4.1.0' in (up.root / 'server/mio_server/__init__.py').read_text()
```

R3-LIFE-04 / 05 共用扩展夹具：

```python
from mio_server.context import AppContext
from mio_server.backups.extension_data import save_settings, load_settings

def make_extension(ctx):
    folder = ctx.extensions.root / 'demo'
    folder.mkdir(parents=True)
    (folder / 'mio-extension.json').write_text(json.dumps({
        'id': 'demo', 'name': 'Demo', 'version': '1.0.0', 'main': 'main.py'}))
    (folder / 'main.py').write_text(
        'def activate(mio):\n    mio.save_settings({"activation_ran": True})\n')
    (folder / 'custom_original.txt').write_text('only original')
    return folder

with tempfile.TemporaryDirectory() as td:
    ctx = AppContext.create(Path(td) / 'workspace', autostart=False, seed_instance=False)
    try:
        folder = make_extension(ctx)
        ctx.extensions.enable('demo', ctx.extensions.info('demo').digest)
        package = io.BytesIO()
        with zipfile.ZipFile(package, 'w') as z:
            z.writestr('mio-extension.json', json.dumps({
                'id': 'demo', 'name': 'Demo', 'version': '2.0.0', 'main': 'main.py'}))
            z.writestr('main.py', 'def activate(mio):\n    pass\n')
        rename = Path.rename
        def denied(path, *args, **kw):
            if path.name == '.staging-demo': raise OSError('rename denied')
            return rename(path, *args, **kw)
        with patch.object(Path, 'rename', denied):
            try: ctx.extensions.install(package.getvalue(), replace=True)
            except OSError: pass
        print(folder.exists(), 'demo' in ctx.extensions.loaded,
              (ctx.extensions.root / '.staging-demo').exists(),
              ctx.settings().extensions['demo'].enabled)
    finally:
        ctx.close()

with tempfile.TemporaryDirectory() as td:
    ctx = AppContext.create(Path(td) / 'workspace', autostart=False, seed_instance=False)
    try:
        make_extension(ctx)
        with patch('mio_server.extensions.trust.remember_package',
                   side_effect=OSError('recovery disk full')):
            try: ctx.extensions.enable('demo', ctx.extensions.info('demo').digest)
            except OSError: pass
        print(ctx.extensions.info('demo').status,
              ctx.settings().extensions['demo'].enabled,
              load_settings(ctx.data_dir, 'demo')['activation_ran'])
    finally:
        ctx.close()
```

R3-LIFE-06：在仓库根通过 Node 执行下列元数据探针，读取实际选择回调与常量；不读任何实际备份。

```javascript
const fs = require('fs');
const api = fs.readFileSync('web/src/api/backups.ts', 'utf8');
const ui = fs.readFileSync('web/src/pages/settings/BackupsSection.tsx', 'utf8');
const backend = fs.readFileSync('server/mio_server/backups/archive.py', 'utf8');
const frontGiB = Number(api.match(/MAX_WORKSPACE_BACKUP_BYTES = (\d+) \* 1024 \*\* 3/)[1]);
const backGiB = Number(backend.match(/MAX_ARCHIVE = (\d+) \* 1024\*\*3/)[1]);
const body = ui.match(/onFile=\{\(selected\) => \{([\s\S]*?)\n            \}\}/)[1];
const choose = new Function('selected', 'MAX_WORKSPACE_BACKUP_BYTES',
    'setError', 'setReport', 'setPlan', 'setStale', 'setFile', 't', body);
for (const size of [2 * 1024 ** 3, 2 * 1024 ** 3 + 1, 12 * 1024 ** 3]) {
    let file = 'unset', error = null;
    choose({name: 'metadata-only.zip', size}, frontGiB * 1024 ** 3,
        value => error = value, () => {}, () => {}, () => {},
        value => file = value, key => key);
    console.log({size, frontendRejected: file === null,
        backendSizeRejected: size > backGiB * 1024 ** 3, error: error?.message});
}
```

## 正常边界与针对性验证

以下 13 个现有测试集中执行，捕获结果为 `Ran 13 tests in 12.162s / OK`。这些测试是覆盖证据，不代替上面的新故障探针；没有新增/修改测试文件。

`tests.test_backup.BackupTests`：

1. `test_export_redacts_credentials_and_retains_assets_checkpoints_and_receipts`
2. `test_stage_apply_checks_head_hash_and_keeps_live_data_until_restart`
3. `test_post_schedule_edit_rejects_install_without_touching_current_work`
4. `test_crash_after_each_directory_move_resumes_without_losing_either_version`
5. `test_failed_install_rolls_back_and_interrupted_rollback_resumes`
6. `test_real_context_restart_installs_api_plan_keeps_trash_and_skips_default_instance`

其他：

7. `tests.test_backup_participants.BackupParticipantsTests.test_external_data_survives_real_backup_restore_without_activating_package`
8. `tests.test_backup_ui_data.BackupUIDataTests.test_extension_preferences_survive_restore_and_retained_data_needs_no_code`
9. `tests.test_backup_ui_data.BackupUIDataTests.test_edit_after_scheduling_rejects_restore_without_losing_private_state`
10. `tests.test_update.UpdaterTests.test_check_download_stage_apply`
11. `tests.test_update_catalog.ReleaseCatalogTests.test_failed_dependency_setup_restores_program_and_previous_dependencies`
12. `tests.test_extension_dependencies.ExtensionRequirementsTests.test_exact_plan_and_every_host_version_are_constraints_for_no_deps_install`
13. `tests.test_extension_dependencies.ExtensionRequirementsTests.test_shared_environment_change_during_preflight_blocks_install`

由此实际验证了：导出→预检/暂存→head/hash 确认→保护备份→保持当前工作区→真实 AppContext 下次创建安装；安排后继续编辑拒绝；两个目录交换点中断可续装、回滚中断可续回滚；垃圾箱与暂停设置保留；外部扩展规则不激活主入口，私有偏好和卸载保留数据可恢复。签名更新的普通成功/验证失败回滚路径通过，但未覆盖的新交错仍出现上述实证。

## 合理怀疑与排除

- 更新 CLI 在工作区上下文建立前运行，没有证明其排斥仍运行的旧服务；本报告**未**启动真实服务或执行依赖变更，不把“更新运行中服务”另立已复现缺陷。R3-LIFE-01 已独立证明两个合法安装器之间不互斥。
- R3-LIFE-05 可能进一步影响自定义数据契约的可备份范围；只确认了失败后 active/enabled 状态未回退，未把数据丢失推断写成已实测事实。
- 依赖安装的跨工作区/外部进程事务、构建脚本副作用与产物哈希锁定缺失，文档已明确披露，不作为新缺陷重复报告。
- 私有设置在备份期间的并发原子写一致性只阅读了调用/锁边界；没有得到可复现的内容丢失证据，未列为缺陷。
