"""Resolve an extension's optional, reviewed requirements in Mio's Python environment."""

from __future__ import annotations

import importlib.metadata
import json
import re
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
PACKAGE_NAME = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\Z")


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
    if requirement.url:
        return False
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
    extras = {"", *requirement.extras}
    for raw in distribution.requires or ():
        try:
            dependency = Requirement(raw)
        except (InvalidRequirement, TypeError):
            return False
        if dependency.marker and not any(
            dependency.marker.evaluate(environment={"extra": extra}) for extra in extras
        ):
            continue
        if not _satisfied_with(dependency, checked):
            return False
    return True


def _package_version(name, version) -> tuple[str, Version]:
    """Only index package identities expressible as exact pip requirements are supported."""
    if (
        not isinstance(name, str)
        or not PACKAGE_NAME.fullmatch(name)
        or not isinstance(version, str)
        or version != version.strip()
    ):
        raise RequirementError("pip 依赖预检查计划包含无效的包名或版本")
    try:
        parsed = Version(version)
        Requirement(f"{name}=={parsed}")
    except (InvalidVersion, InvalidRequirement):
        raise RequirementError("pip 依赖预检查计划包含无效的包名或版本") from None
    return canonicalize_name(name), parsed


def _installed_versions() -> dict[str, Version]:
    """Freeze the shared environment, including packages absent from this dependency closure."""
    installed = {}
    for distribution in importlib.metadata.distributions():
        name, version = _package_version(distribution.metadata.get("Name"), distribution.version)
        if name in installed and installed[name] != version:
            raise RequirementError("Mio 共用环境存在同名多版本包；请先解决版本冲突，未安装")
        installed[name] = version
    return installed


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate pip report key")
        result[key] = value
    return result


def _install_plan(report_path: Path, requirements, installed) -> dict[str, Version]:
    try:
        report = json.loads(
            report_path.read_text(encoding="utf-8"), object_pairs_hook=_unique_pairs
        )
        actions = report["install"]
        if not isinstance(actions, list) or not actions:
            raise ValueError
    except (OSError, UnicodeError, ValueError, KeyError, TypeError):
        raise RequirementError("pip 依赖预检查未返回有效计划") from None
    direct = {canonicalize_name(requirement.name): requirement for _, requirement in requirements}
    plan = {}
    for action in actions:
        if not isinstance(action, dict) or not isinstance(action.get("metadata"), dict):
            raise RequirementError("pip 依赖预检查计划格式无效")
        metadata = action["metadata"]
        name, planned_version = _package_version(metadata.get("name"), metadata.get("version"))
        download = action.get("download_info", {})
        if (
            action.get("is_direct", False) is not False
            or not isinstance(download, dict)
            or {"dir_info", "vcs_info"}.intersection(download)
        ):
            raise RequirementError("pip 依赖预检查计划包含无法固定的 URL、目录或 VCS 来源；未安装")
        if name in plan:
            raise RequirementError("pip 依赖预检查计划包含重复包；未安装")
        # Check the snapshot and the current lookup. A package appearing during preflight
        # cannot borrow a previously missing name to replace its now-installed version.
        current = installed.get(name)
        try:
            distribution = importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            pass
        else:
            _, current_version = _package_version(name, distribution.version)
            if current is not None and current != current_version:
                raise RequirementError("Mio 共用环境在依赖预检查期间发生变化；未安装")
            current = current_version
        if current is not None and current != planned_version:
            raise RequirementError(
                f"依赖 {name} 将更改 Mio 共用环境中已安装的版本；请先解决版本冲突，未安装"
            )
        requirement = direct.get(name)
        if requirement and not requirement.specifier.contains(planned_version, prereleases=True):
            raise RequirementError(f"依赖 {name} 的计划版本不满足扩展要求；未安装")
        plan[name] = planned_version
    for name, requirement in direct.items():
        if name in plan:
            continue
        try:
            distribution = importlib.metadata.distribution(name)
            _, version = _package_version(name, distribution.version)
        except importlib.metadata.PackageNotFoundError:
            raise RequirementError("pip 依赖预检查计划遗漏缺失的直接依赖；未安装") from None
        if not requirement.specifier.contains(version, prereleases=True):
            raise RequirementError("pip 依赖预检查计划遗漏不满足版本的直接依赖；未安装")
    return plan


def ensure_requirements(folder: Path) -> tuple[str, ...]:
    """Install only missing or incompatible packages after the extension has been reviewed."""
    requirements = _requirements(folder)
    missing = [source for source, requirement in requirements if not _satisfied(requirement)]
    if not missing:
        return ()
    installed_versions = _installed_versions()
    command = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
    ]
    try:
        with tempfile.TemporaryDirectory(prefix="mio-extension-requirements-") as temporary:
            report_path = Path(temporary) / "pip-report.json"
            preflight = subprocess.run(
                [*command, "--dry-run", "--report", str(report_path), *missing],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=INSTALL_TIMEOUT_SECONDS,
                check=False,
            )
            if preflight.returncode:
                raise RequirementError(f"pip 依赖预检查失败（退出码 {preflight.returncode}）")
            plan = _install_plan(report_path, requirements, installed_versions)
            if _installed_versions() != installed_versions:
                raise RequirementError("Mio 共用环境在依赖预检查期间发生变化；未安装")
            constraints = Path(temporary) / "constraints.txt"
            constraints.write_text(
                "".join(
                    f"{name}=={version}\n"
                    for name, version in sorted({**installed_versions, **plan}.items())
                ),
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    *command,
                    "--no-deps",
                    "--constraint",
                    str(constraints),
                    *(f"{name}=={version}" for name, version in sorted(plan.items())),
                ],
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
    actual_versions = _installed_versions()
    if any(actual_versions.get(name) != version for name, version in installed_versions.items()):
        raise RequirementError("pip 安装后 Mio 共用环境版本发生变化；请检查环境")
    for name, version in plan.items():
        try:
            actual = Version(importlib.metadata.distribution(name).version)
        except (importlib.metadata.PackageNotFoundError, InvalidVersion):
            actual = None
        if actual != version:
            raise RequirementError(f"pip 安装后依赖 {name} 与预检查的固定版本不符")
    remaining = [requirement.name for _, requirement in requirements if not _satisfied(requirement)]
    if remaining:
        raise RequirementError("pip 安装后仍未满足依赖：" + ", ".join(remaining))
    return tuple(missing)
