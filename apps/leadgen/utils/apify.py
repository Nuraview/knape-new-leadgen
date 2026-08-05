"""Lazy ``ApifyClient`` import (optional ``apify-client`` package)."""

from __future__ import annotations

from typing import Any


def apify_client_class() -> Any | None:
    try:
        from apify_client import ApifyClient

        return ApifyClient
    except ModuleNotFoundError:
        return None
