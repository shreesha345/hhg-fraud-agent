"""Launch the TigerGraph MCP server (stdio) with a fresh JWT. Tokens last one hour, so the launcher exchanges TG_SECRET each start.
Never prints the secret or token.   uv run python scripts/tg_mcp_launcher.py [graph]"""
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from fraudpy.tg import TG, _env

e = _env()
graph = sys.argv[1] if len(sys.argv) > 1 else e.get("TG_GRAPH_TEST", "FraudTest")
host = e["TG_HOST"].rstrip("/")
env = dict(os.environ, TG_HOST=host, TG_GRAPHNAME=graph, TG_API_TOKEN=TG().token(), TG_JWT_TOKEN=TG().token(),
           TG_RESTPP_PORT=e.get("TG_RESTPP_PORT", "443"), TG_GS_PORT=e.get("TG_GS_PORT", "443"), TG_SSL_VERIFY="true")
exe = Path(sys.executable).with_name("tigergraph-mcp.exe")
sys.exit(subprocess.call([str(exe)], env=env))
