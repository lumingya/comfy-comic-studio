"""Resolve an extension's optional, reviewed requirements in Mio's Python environment."""

from __future__ import annotations

import importlib.metadata
import json
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

from packaging.requirements import InvalidRequirement, Requirement
from packaging.utils import canonicalize_name
from packaging.version import InvalidVersion, Version

from .manifest import inside

REQUIREMENTS_FILE = "requirements.txt"
MAX_REQUIREMENTS_BYTES = 64 * 1024
MAX_REQUIREMENTS = 100
INSTALL_TIMEOUT_SECONDS = 300


class RequirementError(ValueError):
    pass


def _requirements(folder: Path) -> tuple[tuple[str, Requirement], ...]:
    candidate = folder / REQUIREMENTS_FILE
    try:
        metadata = candidate.lstat()
    except FileNotFoundError:
        return ()
    if (
        stat.S_ISLNK(metadata.st_mode)
        or getattr(metadata, "st_file_attributes", 0)
        & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
        or not stat.S_ISREG(metadata.st_mode)
    ):
        raise RequirementError("requirements.txt 必须是扩展目录中的普通文件")
    path = inside(folder, REQUIREMENTS_FILE)
    if path.resolve() != path.absolute():
        raise RequirementError("requirements.txt 必须位于扩展目录内")
    if path.stat().st_size > MAX_REQUIREMENTS_BYTES:
        raise RequirementError("requirements.txt 超过 64 KB")
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise RequirementError(f"读取 requirements.txt 失败：{exc}") from None
    parsed: list[tuple[str, Requirement]] = []
    seen: set[str] = set()
    dependency_count = 0
    for number, raw in enumerate(lines, 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        dependency_count += 1
        if dependency_count > MAX_REQUIREMENTS:
            raise RequirementError("requirements.txt 最多支持 100 个依赖")
        if len(line) > 500 or line.startswith(("-", ".", "/", "\\")):
            raise RequirementError(f"requirements.txt 第 {number} 行不是受支持的包声明")
        try:
            requirement = Requirement(line)
        except InvalidRequirement as exc:
            raise RequirementError(f"requirements.txt 第 {number} 行无效：{exc}") from None
        if requirement.url:
            raise RequirementError(f"requirements.txt 第 {number} 行不允许直接 URL 或本地路径")
        if requirement.marker and not requirement.marker.evaluate():
            continue
        normalized = canonicalize_name(requirement.name)
        if normalized in seen:
            raise RequirementError(f"requirements.txt 第 {number} 行重复声明了 {requirement.name}")
        seen.add(normalized)
        parsed.append((line, requirement))
    return tuple(parsed)


def _satisfied(requirement: Requirement) -> bool:
    return _satisfied_with(requirement, set())


def _satisfied_with(
    requirement: Requirement, checked: set[tuple[str, str, tuple[str, ...]]]
) -> bool:
    key = (
        canonicalize_name(requirement.name),
        str(requirement.specifier),
        tuple(sorted(requirement.extras)),
    )
    if key in checked:
        return True
    checked.add(key)
    try:
        distribution = importlib.metadata.distribution(requirement.name)
        installed = Version(distribution.version)
    except (importlib.metadata.PackageNotFoundError, InvalidVersion):
        return False
    if not requirement.specifier.contains(installed, prereleases=True):
        return False
    for extra in requirement.extras:
        for raw in distribution.requires or ():
            try:
                dependency = Requirement(raw)
            except InvalidRequirement:
                return False
            if dependency.marker and not dependency.marker.evaluate(environment={"extra": extra}):
                continue
            if not _satisfied_with(dependency, checked):
                return False
    return True


def ensure_requirements(folder: Path) -> tuple[str, ...]:
    """Install only missing or incompatible packages after the extension has been reviewed."""
    requirements = _requirements(folder)
    missing = [source for source, requirement in requirements if not _satisfied(requirement)]
    if not missing:
        return ()
    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        *missing,
    ]
    try:
        with tempfile.TemporaryDirectory(prefix="mio-extension-requirements-") as temporary:
            report_path = Path(temporary) / "pip-report.json"
            preflight = subprocess.run(
                [*command[:4], "--dry-run", "--report", str(report_path), *command[4:]],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=INSTALL_TIMEOUT_SECONDS,
                check=False,
            )
            if preflight.returncode:
                raise RequirementError(f"pip 依赖预检查失败（退出码 {preflight.returncode}）")
            try:
                report = json.loads(report_path.read_text(encoding="utf-8"))
                actions = report["install"]
                if not isinstance(actions, list):
                    raise ValueError
            except (OSError, UnicodeError, ValueError, KeyError, TypeError):
                raise RequirementError("pip 依赖预检查未返回有效计划") from None
            direct = {
                canonicalize_name(requirement.name): requirement for _, requirement in requirements
            }
            for action in actions:
                if not isinstance(action, dict):
                    raise RequirementError("pip 依赖预检查计划格式无效")
                metadata = action.get("metadata", {})
                if not isinstance(metadata, dict):
                    raise RequirementError("pip 依赖预检查计划格式无效")
                name, version = metadata.get("name"), metadata.get("version")
                if not isinstance(name, str) or not isinstance(version, str):
                    raise RequirementError("pip 依赖预检查计划格式无效")
                try:
                    planned_version = Version(version)
                except InvalidVersion:
                    raise RequirementError("pip 依赖预检查计划包含无效版本") from None
                requirement = direct.get(canonicalize_name(name))
                try:
                    installed = importlib.metadata.distribution(name)
                except importlib.metadata.PackageNotFoundError:
                    if requirement and not requirement.specifier.contains(
                        planned_version, prereleases=True
                    ):
                        raise RequirementError(f"依赖 {name} 的计划版本不满足扩展要求；未安装")
                    continue
                try:
                    changed = Version(installed.version) != planned_version
                except InvalidVersion:
                    changed = True
                if changed:
                    raise RequirementError(
                        f"依赖 {name} 将更改 Mio 共用环境中已安装的版本；请先解决版本冲突，未安装"
                    )
                if requirement and not requirement.specifier.contains(
                    planned_version, prereleases=True
                ):
                    raise RequirementError(f"依赖 {name} 的计划版本不满足扩展要求；未安装")
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=INSTALL_TIMEOUT_SECONDS,
                check=False,
            )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RequirementError(f"安装扩展依赖失败：{exc}") from None
    if result.returncode:
        raise RequirementError(f"pip 安装扩展依赖失败（退出码 {result.returncode}）")
    remaining = [requirement.name for _, requirement in requirements if not _satisfied(requirement)]
    if remaining:
        raise RequirementError("pip 安装后仍未满足依赖：" + ", ".join(remaining))
    return tuple(missing)
