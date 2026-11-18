"""Minimal async client for Jev on OpenRouter's Decisions API."""

import asyncio
import os
import random
from pathlib import Path

import httpx

DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions"


def load_env(path: Path) -> None:
    """Read KEY=VALUE lines from a .env file into os.environ (existing vars win)."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if value and key.strip() not in os.environ:
            os.environ[key.strip()] = value


class JevError(Exception):
    pass


class JevClient:
    def __init__(self, model: str | None = None, concurrency: int = 8):
        self.key = os.environ.get("OPENROUTER_API_KEY", "")
        if not self.key:
            raise JevError("OPENROUTER_API_KEY is empty. Paste your key into the .env file.")
        self.model = model or os.environ.get("JEV_MODEL", "typesafe/jev-1.14")
        self.sem = asyncio.Semaphore(concurrency)
        self.http = httpx.AsyncClient(timeout=20)
        self._paused_until = 0.0

    async def close(self):
        await self.http.aclose()

    async def decide(self, state, questions: dict, attempts: int = 3) -> dict:
        payload = {"model": self.model, "state": state, "questions": questions}
        headers = {"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        loop = asyncio.get_running_loop()
        async with self.sem:
            for attempt in range(attempts):
                # All workers back off together when one gets rate limited.
                wait = self._paused_until - loop.time()
                if wait > 0:
                    await asyncio.sleep(wait)
                try:
                    t0 = loop.time()
                    r = await self.http.post(DECISIONS_URL, json=payload, headers=headers)
                    request_ms = (loop.time() - t0) * 1000
                except httpx.TransportError as e:
                    if attempt + 1 >= attempts:
                        raise JevError(f"Network error: {e}") from e
                    await asyncio.sleep(self._backoff(attempt))
                    continue
                if r.status_code == 200:
                    data = r.json()
                    if "answers" not in data:
                        raise JevError(f"Unexpected response: {r.text[:300]}")
                    data["_ms"] = round(request_ms)  # round trip of the request itself, not time spent queued
                    return data
                body = r.text
                transient = (
                    r.status_code == 429
                    or r.status_code >= 500
                    or (r.status_code == 402 and "openrouter_in_flight_budget" in body)
                )
                if not transient or attempt + 1 >= attempts:
                    raise JevError(f"Jev HTTP {r.status_code}: {body[:500]}")
                retry_after = r.headers.get("Retry-After", "")
                delay = float(retry_after) if retry_after.replace(".", "", 1).isdigit() else self._backoff(attempt)
                self._paused_until = max(self._paused_until, loop.time() + delay)
        raise JevError("Out of retries")

    @staticmethod
    def _backoff(attempt: int) -> float:
        return min(30.0, 2 ** attempt) + random.random()
