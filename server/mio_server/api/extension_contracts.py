"""Publish inert extension schemas through both existing OpenAPI documents."""

from fastapi import FastAPI

from ..extensions.protocol import CONTRACT_VERSION, contract_schemas


def install_contract_schemas(app: FastAPI) -> None:
    original_openapi = app.openapi

    def openapi() -> dict:
        schema = original_openapi()
        if schema.get("x-mio-extension-contract-version") == CONTRACT_VERSION:
            return schema
        components = schema.setdefault("components", {}).setdefault("schemas", {})
        for name, value in contract_schemas().items():
            if name in components and components[name] != value:
                raise ValueError(f"extension contract schema name collision: {name}")
            components[name] = value
        schema["x-mio-extension-contract-version"] = CONTRACT_VERSION
        return schema

    app.openapi = openapi
