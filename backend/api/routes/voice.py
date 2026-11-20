"""Browser WebRTC signalling endpoints for the consumer multimodal portal."""

from __future__ import annotations

import ipaddress
import logging
from functools import lru_cache

from fastapi import APIRouter, Depends, Request, Response, status

from backend.api.schemas import (
    ConsumerConfigurationResponse,
    VoiceIcePatchRequest,
    VoiceOfferRequest,
    VoiceOfferResponse,
)
from backend.api.voice_sessions import get_voice_session_manager
from backend.config.settings import AppSettings, get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/voice", tags=["Consumer Voice"])

TrustedNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


@lru_cache(maxsize=8)
def parse_trusted_proxy_networks(value: str) -> tuple[TrustedNetwork, ...]:
    """Parse TRUSTED_PROXY_IPS into networks, skipping entries that are not CIDRs."""
    networks: list[TrustedNetwork] = []
    for entry in value.split(","):
        candidate = entry.strip()
        if not candidate:
            continue
        try:
            networks.append(ipaddress.ip_network(candidate, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid TRUSTED_PROXY_IPS entry: %s", candidate)
    return tuple(networks)


def is_trusted_address(address: str, networks: tuple[TrustedNetwork, ...]) -> bool:
    """Return True when the address belongs to a configured reverse proxy."""
    try:
        parsed = ipaddress.ip_address(address)
    except ValueError:
        return False
    return any(parsed.version == network.version and parsed in network for network in networks)


def resolve_client_ip(request: Request, settings: AppSettings) -> str:
    """Return the caller address used for signalling rate limiting.

    X-Forwarded-For is caller-controlled, so it is only consulted when the direct
    peer is a configured reverse proxy. Walking the header right to left and
    stopping at the first untrusted hop prevents a client from appending a forged
    entry to escape its own rate-limit bucket.
    """
    peer = request.client.host if request.client else "unknown"
    networks = parse_trusted_proxy_networks(settings.trusted_proxy_ips)
    if not networks or not is_trusted_address(peer, networks):
        return peer

    hops = [hop.strip() for hop in request.headers.get("x-forwarded-for", "").split(",") if hop.strip()]
    for hop in reversed(hops):
        if not is_trusted_address(hop, networks):
            return hop
    return hops[0] if hops else peer


@router.get("/config", response_model=ConsumerConfigurationResponse)
def get_consumer_configuration(tenant_id: str = "grand-meridian") -> ConsumerConfigurationResponse:
    """Return browser-safe tenant and concierge metadata for the consumer portal."""
    return get_voice_session_manager().configuration(tenant_id)


@router.post("/offer", response_model=VoiceOfferResponse)
async def create_voice_offer(
    payload: VoiceOfferRequest,
    request: Request,
    settings: AppSettings = Depends(get_settings),
) -> VoiceOfferResponse:
    """Negotiate a local browser-to-server SmallWebRTC peer connection."""
    return await get_voice_session_manager().create_offer(
        payload, client_ip=resolve_client_ip(request, settings)
    )


@router.patch("/offer", status_code=status.HTTP_204_NO_CONTENT)
async def add_voice_ice_candidates(payload: VoiceIcePatchRequest) -> Response:
    """Accept browser trickle ICE candidates for an already-negotiated peer connection."""
    await get_voice_session_manager().add_ice_candidates(payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
