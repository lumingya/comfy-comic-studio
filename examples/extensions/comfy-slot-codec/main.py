"""Example for a node that stores its LoRA settings in a JSON string."""

import json


class PackedLoRA:
    def inspect(self, node):
        if node["class_type"] != "ExamplePackedModel":
            return None
        value = node["inputs"].get("packed_adapters")
        if not isinstance(value, str):
            return None
        return {"path": "packed_adapters", "loras": json.loads(value), "can_append": True}

    def write(self, node, slot, loras):
        entries = [{key: value for key, value in row.items() if key != "key"} for row in loras]
        return {slot["path"]: json.dumps(entries, ensure_ascii=False)}


def activate(mio):
    mio.contribute("workflow_slot_adapter", "packed-lora", PackedLoRA(), contract=1)
