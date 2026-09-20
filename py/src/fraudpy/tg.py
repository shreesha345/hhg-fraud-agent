"""Minimal TigerGraph Savanna client (stdlib only). Reads TG_HOST and TG_SECRET from the repo .env, never prints them.
A database secret is exchanged for a 1-hour JWT (POST /gsql/v1/tokens); the token is refreshed automatically."""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _env() -> dict:
    out = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.split("#")[0].strip() if k.strip() != "TG_SECRET" else v.strip()
    return out


class TG:
    def __init__(self) -> None:
        e = _env()
        self.host, self._secret = e["TG_HOST"].rstrip("/"), e["TG_SECRET"]
        self._tok, self._exp = "", 0.0

    def token(self) -> str:
        if time.time() > self._exp - 120:
            body = json.dumps({"secret": self._secret, "lifetime": "3600"}).encode()
            r = urllib.request.Request(self.host + "/gsql/v1/tokens", data=body, headers={"Content-Type": "application/json"})
            self._tok = json.load(urllib.request.urlopen(r, timeout=60))["token"]
            self._exp = time.time() + 3600
        return self._tok

    def _call(self, method: str, path: str, data: bytes | None, ctype: str, timeout: int = 900) -> str:
        for attempt in range(4):
            r = urllib.request.Request(self.host + path, data=data, method=method,
                                       headers={"Authorization": "Bearer " + self.token(), "Content-Type": ctype})
            try:
                return urllib.request.urlopen(r, timeout=timeout).read().decode("utf-8", "replace")
            except urllib.error.HTTPError as ex:
                txt = ex.read().decode("utf-8", "replace")
                if ex.code in (502, 503, 504) and attempt < 3:
                    time.sleep(3 * (attempt + 1)); continue
                return txt
            except (urllib.error.URLError, TimeoutError):
                if attempt == 3: raise
                time.sleep(3 * (attempt + 1))
        return ""

    def gsql(self, text: str) -> str:
        return self._call("POST", "/gsql/v1/statements", text.encode("utf-8"), "text/plain")

    def get(self, path: str) -> dict:
        return json.loads(self._call("GET", path, None, "application/json"))

    def post_json(self, path: str, obj) -> dict:
        return json.loads(self._call("POST", path, json.dumps(obj).encode("utf-8"), "application/json"))

    def run_query(self, graph: str, name: str, **params) -> dict:
        def enc(v):
            return [urllib.parse.quote(str(x)) for x in v] if isinstance(v, (list, tuple)) else [urllib.parse.quote(str(v))]
        qs = "&".join(f"{k}={x}" for k, v in params.items() for x in enc(v))
        return self.get(f"/restpp/query/{graph}/{name}" + ("?" + qs if qs else ""))

    def load_file(self, graph: str, job: str, filename: str, path: Path, sep: str = "\t") -> dict:
        """POST a local file as the body of a loading job (no shared folder needed in the cloud)."""
        q = urllib.parse.urlencode({"tag": job, "filename": filename, "sep": sep, "eol": "\n"})
        return json.loads(self._call("POST", f"/restpp/ddl/{graph}?{q}", path.read_bytes(), "text/plain; charset=utf-8", timeout=1800))
