/* Pure workflow mapping contract. No DOM, state, transport or automatic retargeting. */
"use strict";
const WorkflowMapping = (() => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const SKIP = Symbol("keep-original");
  function isWorkflowLink(value, workflow) {
    return (
      Array.isArray(value) &&
      value.length === 2 &&
      (typeof value[0] === "string" ||
        (typeof value[0] === "number" &&
          Object.hasOwn(workflow, String(value[0])))) &&
      Number.isInteger(value[1])
    );
  }

  function inputPathParts(path) {
    if (typeof path !== "string" || !path.trim())
      throw Error("请填写节点输入字段。");
    const pointer = path.startsWith("/");
    if (pointer && /~(?![01])/.test(path))
      throw Error("JSON Pointer 转义无效；使用 ~0 表示 ~，~1 表示 /。");
    const parts = pointer
      ? path
          .slice(1)
          .split("/")
          .map((x) => x.replace(/~1/g, "/").replace(/~0/g, "~"))
      : path.split(".");
    if (
      parts.some(
        (p) =>
          (!pointer && !p) ||
          ["__proto__", "constructor", "prototype"].includes(p),
      )
    )
      throw Error("输入路径含非法属性。");
    return parts;
  }

  function inputAt(node, path, workflow) {
    let value = node.inputs;
    for (const p of inputPathParts(path)) {
      if (workflow && isWorkflowLink(value, workflow))
        return { exists: false, blocked: true, value };
      if (
        Array.isArray(value) &&
        (!/^(0|[1-9]\d*)$/.test(p) || Number(p) >= value.length)
      )
        return { exists: false, invalidArray: true };
      if (
        value === null ||
        typeof value !== "object" ||
        !Object.hasOwn(value, p)
      )
        return { exists: false };
      value = value[p];
    }
    return { exists: true, value };
  }

  function writeInputAt(node, path, value, allowCreate = false, workflow) {
    const parts = inputPathParts(path);
    let obj = node.inputs;
    for (const [index, key] of parts.entries()) {
      if (obj === null || typeof obj !== "object")
        throw Error("不能穿过已有标量写入路径：" + path);
      if (workflow && isWorkflowLink(obj, workflow))
        throw Error("不能修改节点连线内部：" + path);
      if (
        Array.isArray(obj) &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= obj.length)
      )
        throw Error("数组索引必须已存在：" + path);
      const exists = Object.hasOwn(obj, key);
      if (!exists && !allowCreate) throw Error("输入字段不存在：" + path);
      if (index === parts.length - 1) {
        if (workflow && exists && containsLink(obj[key], workflow))
          throw Error("不能覆盖节点连线：" + path);
        obj[key] = value;
        return;
      }
      if (!exists) {
        if (/^(0|[1-9]\d*)$/.test(parts[index + 1]))
          throw Error("嵌套数组需在工作流中预先存在：" + path);
        obj[key] = {};
      }
      obj = obj[key];
    }
  }

  function validateMappingTargets(workflow, bindings) {
    const issues = [],
      targets = [];
    for (const b of bindings) {
      if (!b.enabled || b.source === "inherit") continue;
      try {
        const node = Object.hasOwn(workflow, String(b.nodeId))
          ? workflow[String(b.nodeId)]
          : null;
        if (!node) throw Error("节点 #" + b.nodeId + " 不存在。");
        const parts = inputPathParts(b.path),
          target = { id: b.id, node: String(b.nodeId), parts };
        for (const previous of targets) {
          if (
            previous.node === target.node &&
            previous.parts
              .slice(0, Math.min(parts.length, previous.parts.length))
              .every((p, i) => p === parts[i])
          ) {
            const message =
              previous.parts.length === parts.length
                ? "同一输入存在重复启用映射。"
                : "父路径与子路径同时映射，写入顺序不明确。";
            issues.push({ id: previous.id, message });
            issues.push({ id: b.id, message });
          }
        }
        targets.push(target);
        const info = inputAt(node, b.path, workflow);
        if (info.blocked || (info.exists && containsLink(info.value, workflow)))
          throw Error("目标是节点连线；请映射上游节点的实际输入字段。");
        if (!info.exists && !b.allowCreate)
          throw Error("字段 " + b.path + " 不存在。");
        if (!info.exists) {
          const copy = clone(node);
          writeInputAt(copy, b.path, null, !!b.allowCreate, workflow);
        }
      } catch (e) {
        issues.push({ id: b.id, message: e.message });
      }
    }
    return issues.filter(
      (issue, i, all) =>
        all.findIndex(
          (x) => x.id === issue.id && x.message === issue.message,
        ) === i,
    );
  }

  function guessValueType(value) {
    return typeof value === "number"
      ? "number"
      : typeof value === "boolean"
        ? "boolean"
        : value && typeof value === "object"
          ? "json"
          : "text";
  }

  function castBoundValue(value, type, original) {
    let target = type === "auto" ? guessValueType(original) : type;
    if (target === "text")
      return value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : String(value ?? "");
    if (target === "number") {
      if (
        value === null ||
        value === undefined ||
        typeof value === "object" ||
        (typeof value === "string" && !value.trim()) ||
        !Number.isFinite(Number(value))
      )
        throw Error("映射值不是有效数字。");
      return Number(value);
    }
    if (target === "boolean") {
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "1" || value === 1) return true;
      if (value === "false" || value === "0" || value === 0) return false;
      throw Error("开关映射只接受 true / false 或 1 / 0。");
    }
    if (target === "json") {
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch (e) {
          throw Error("映射值不是有效 JSON。");
        }
      }
      return clone(value);
    }
    throw Error("映射类型不受支持。");
  }
  function containsLink(value, workflow) {
    return (
      isWorkflowLink(value, workflow) ||
      (!!value &&
        typeof value === "object" &&
        Object.values(value).some((v) => containsLink(v, workflow)))
    );
  }
  function samePath(a, b) {
    try {
      return (
        JSON.stringify(inputPathParts(a)) === JSON.stringify(inputPathParts(b))
      );
    } catch {
      return false;
    }
  }
  function validateSchema(node, path, value, objectInfo = {}) {
    const parts = inputPathParts(path);
    if (parts.length !== 1) return;
    const info = objectInfo[node.class_type],
      rule = { ...info?.input?.required, ...info?.input?.optional }[parts[0]];
    if (!Array.isArray(rule)) return;
    if (rule[0] === "INT" && !Number.isInteger(value))
      throw Error("节点字段需要整数。");
    if (
      ["INT", "FLOAT"].includes(rule[0]) &&
      (typeof value !== "number" || !Number.isFinite(value))
    )
      throw Error("节点字段需要数字。");
    if (rule[0] === "BOOLEAN" && typeof value !== "boolean")
      throw Error("节点字段需要布尔值。");
    if (rule[0] === "STRING" && typeof value !== "string")
      throw Error("节点字段需要文本。");
    if (
      typeof value === "number" &&
      ((Number.isFinite(rule[1]?.min) && value < rule[1].min) ||
        (Number.isFinite(rule[1]?.max) && value > rule[1].max))
    )
      throw Error("超出节点声明的数值范围。");
    if (Array.isArray(rule[0]) && !rule[0].includes(value))
      throw Error("不在节点的可选值列表中。");
  }
  function compile(
    blueprint,
    bindings,
    { resolve, objectInfo = {}, outputNodeId = "" },
  ) {
    if (outputNodeId && !Object.hasOwn(blueprint, String(outputNodeId)))
      throw Error("结果图片节点 #" + outputNodeId + " 不存在。");
    const issues = validateMappingTargets(blueprint, bindings);
    if (issues.length) {
      const error = Error(issues[0].message);
      error.issues = issues;
      throw error;
    }
    const workflow = clone(blueprint),
      changes = [],
      skipped = [];
    for (const binding of bindings) {
      if (!binding.enabled || binding.source === "inherit") continue;
      try {
        const node = workflow[String(binding.nodeId)],
          original = inputAt(node, binding.path, workflow),
          resolved = resolve(binding);
        if (resolved === SKIP) {
          skipped.push({ id: binding.id, reason: "来源未提供，保留工作流原值" });
          continue;
        }
        const value = castBoundValue(resolved, binding.type, original.value);
        validateSchema(node, binding.path, value, objectInfo);
        writeInputAt(
          node,
          binding.path,
          value,
          !!binding.allowCreate,
          workflow,
        );
        changes.push({
          label: binding.label,
          nodeId: binding.nodeId,
          path: binding.path,
          from: original.value,
          to: value,
        });
      } catch (error) {
        throw Error("映射「" + binding.label + "」：" + error.message);
      }
    }
    return { workflow, changes, skipped };
  }
  return Object.freeze({
    SKIP,
    compile,
    validateSchema,
    samePath,
    isWorkflowLink,
    inputPathParts,
    inputAt,
    writeInputAt,
    validateMappingTargets,
    guessValueType,
    castBoundValue,
  });
})();
