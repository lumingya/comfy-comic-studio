"""Explicit immutable dependency records, usable with isolated test doubles."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ApplicationServices:
    image_url_to_data_url: Any
    PayloadTooLargeError: Any
    BASE_DIR: Any
    CONFIG_LOCK: Any
    DATA_DIR: Any
    IMAGES_DIR: Any
    MAX_IMAGE_BYTES: Any
    ProviderHTTPError: Any
    chat_proxy: Any
    detect_image_mime_type: Any
    fetch_remote_image: Any
    generate_provider_image: Any
    local_path_from_url: Any
    mio_foundation: Any
    native_store: Any
    provider_image_input: Any
    provider_operation: Any
    list_provider_models: Any
    read_limited_response: Any
    read_merged_config: Any
    read_merged_config_raw: Any
    store_image_bytes: Any
    store_image_data: Any
    store_image_stream: Any
    validate_config_payload: Any
    write_json_file: Any
    write_split_config: Any


@dataclass(frozen=True)
class HTTPServices:
    ALLOWED_ORIGINS: Any
    BASE_DIR: Any
    CONFIG_LOCK: Any
    DATA_DIR: Any
    LibraryError: Any
    MAX_IMAGE_BYTES: Any
    MAX_JSON_BODY_BYTES: Any
    PayloadTooLargeError: Any
    ProviderHTTPError: Any
    application: Any
    bytes_to_data_url: Any
    chat_proxy: Any
    content_store: Any
    fetch_remote_image: Any
    fetch_remote_json: Any
    generate_provider_image: Any
    get_marketplace_catalog: Any
    handle_vision_audit: Any
    image_url_to_data_url: Any
    is_public_static_path: Any
    list_provider_models: Any
    manage_native_credentials: Any
    native_store: Any
    provider_operation: Any
    read_merged_config: Any
    store_image_bytes: Any
    store_image_data: Any
