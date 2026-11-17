"""Portable extension directory and verified package installation."""

from pydantic import BaseModel, Field

from ..extensions.marketplace import Marketplace
from .deps import Ctx
from .operations import Router as APIRouter

router = APIRouter(tags=["extensions"])


class MarketSourceRequest(BaseModel):
    url: str = Field(default="", max_length=4000)


class MarketInstallRequest(BaseModel):
    expected_catalog_digest: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    expected_sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")


@router.get("/extension-market")
def get_extension_market(ctx: Ctx, refresh: bool = False) -> dict:
    return Marketplace(ctx).catalog(refresh=refresh)


@router.put("/extension-market/source")
def set_extension_market_source(ctx: Ctx, body: MarketSourceRequest) -> dict:
    return Marketplace(ctx).set_source(body.url)


@router.post("/extension-market/{ext_id}/install", status_code=201)
def install_market_extension(ctx: Ctx, ext_id: str, body: MarketInstallRequest) -> dict:
    return Marketplace(ctx).install(ext_id, body.expected_catalog_digest, body.expected_sha256)
