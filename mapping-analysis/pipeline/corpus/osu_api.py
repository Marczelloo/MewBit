"""Minimal osu! API v2 client (client credentials grant), with an on-disk response cache.

Credentials come only from the environment (OSU_CLIENT_ID, OSU_CLIENT_SECRET). They are never printed, logged or
written anywhere; the access token lives in memory only. Requests are paced to about one per second (osu! asks API
users to stay around 60 requests per minute) and every response is cached under --cache, so a run can resume.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://osu.ppy.sh/api/v2"
TOKEN_URL = "https://osu.ppy.sh/oauth/token"
MIN_INTERVAL_S = 1.0


class OsuApi:
    def __init__(self, cache: Path, min_interval_s: float = MIN_INTERVAL_S):
        cid, secret = os.environ.get("OSU_CLIENT_ID"), os.environ.get("OSU_CLIENT_SECRET")
        if not cid or not secret:
            raise SystemExit("OSU_CLIENT_ID and OSU_CLIENT_SECRET must be set in the environment.")
        self._cid, self._secret = cid, secret
        self._token: str | None = None
        self._expires = 0.0
        self._last = 0.0
        self.cache = cache
        self.cache.mkdir(parents=True, exist_ok=True)
        self.min_interval_s = min_interval_s

    def _auth(self) -> str:
        if self._token and time.time() < self._expires - 60:
            return self._token
        body = urllib.parse.urlencode({"client_id": self._cid, "client_secret": self._secret,
                                       "grant_type": "client_credentials", "scope": "public"}).encode()
        req = urllib.request.Request(TOKEN_URL, data=body, headers={"Accept": "application/json",
                                                                     "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        self._token = data["access_token"]
        self._expires = time.time() + float(data.get("expires_in", 3600))
        return self._token

    def get(self, path: str, params: dict | None = None, use_cache: bool = True) -> dict:
        query = urllib.parse.urlencode(sorted((params or {}).items()))
        key = hashlib.sha1(f"{path}?{query}".encode()).hexdigest()
        cached = self.cache / f"{key}.json"
        if use_cache and cached.exists():
            return json.loads(cached.read_text())
        for attempt in range(5):
            wait = self.min_interval_s - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
            req = urllib.request.Request(f"{API}{path}" + (f"?{query}" if query else ""),
                                         headers={"Authorization": f"Bearer {self._auth()}", "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = json.load(r)
                break
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    self._token = None
                elif e.code not in (429, 500, 502, 503, 504):
                    raise RuntimeError(f"GET {path} failed: HTTP {e.code}") from None
                time.sleep(2 ** (attempt + 1))
            except urllib.error.URLError:
                time.sleep(2 ** (attempt + 1))
        else:
            raise RuntimeError(f"GET {path} kept failing")
        cached.write_text(json.dumps({"_request": {"path": path, "params": params or {}}, **data}))
        return data
