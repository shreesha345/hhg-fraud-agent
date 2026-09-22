"""Launch the TigerGraph MCP server (stdio) with a fresh JWT. Tokens last one hour, so the launcher exchanges TG_SECRET each start.
Never prints the secret or token.   uv run python scripts/tg_mcp_launcher.py [graph]"""
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

try:
    from fraudpy.tg import TG, _env
    
    e = _env()
    graph = sys.argv[1] if len(sys.argv) > 1 else e.get("TG_GRAPH_TEST", "FraudTest")
    host = e["TG_HOST"].rstrip("/")
    
    # Fetch token first to catch any auth errors early
    token = TG().token()
    
    env = dict(os.environ, TG_HOST=host, TG_GRAPHNAME=graph, TG_API_TOKEN=token, TG_JWT_TOKEN=token,
               TG_RESTPP_PORT=e.get("TG_RESTPP_PORT", "443"), TG_GS_PORT=e.get("TG_GS_PORT", "443"), TG_SSL_VERIFY="true")
    exe = Path(sys.executable).with_name("tigergraph-mcp.exe")

    # Diagnostic output to stderr so it doesn't interfere with stdio MCP communication
    print(f"[launcher] Python: {sys.executable}", file=sys.stderr)
    print(f"[launcher] MCP exe: {exe}", file=sys.stderr)
    print(f"[launcher] MCP exists: {exe.exists()}", file=sys.stderr)
    print(f"[launcher] Graph: {graph}", file=sys.stderr)
    print(f"[launcher] Host: {host}", file=sys.stderr)

    if not exe.exists():
        print(f"[launcher] ERROR: tigergraph-mcp.exe not found at {exe}", file=sys.stderr)
        sys.exit(1)

    print(f"[launcher] Starting TigerGraph MCP server...", file=sys.stderr)
    sys.exit(subprocess.call([str(exe)], env=env))
    
except Exception as ex:
    print(f"[launcher] FATAL: {type(ex).__name__}: {ex}", file=sys.stderr)
    import traceback
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
