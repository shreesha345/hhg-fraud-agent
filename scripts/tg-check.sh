#!/usr/bin/env bash
# Checks the TigerGraph Savanna connection (needs only bash, curl and node) using the values in .env. Prints results only; never prints the secret or token.
#   bash scripts/tg-check.sh
# Exit code 0 = reachable, authenticated and GSQL works.
set -u
cd "$(dirname "$0")/.."
get() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/$//' -e 's/[[:space:]]*$//'; }
H=$(get TG_HOST); S=$(get TG_SECRET); TOK=$(get TG_API_TOKEN); U=$(get TG_USERNAME); P=$(get TG_PASSWORD)
ok=0; say() { printf "%-34s %s\n" "$1" "$2"; }

[ -z "$H" ] && { say "TG_HOST" "MISSING in .env"; exit 2; }
say "workspace address" "$H"

r=$(curl -s -m 20 "$H/restpp/echo" || true)
case "$r" in *"Hello GSQL"*) say "reachable (echo)" "yes";; *) say "reachable (echo)" "NO (workspace suspended? resume it in Savanna)"; exit 1;; esac

# obtain a bearer token: secret > existing token > username/password
T=""
if [ -n "$S" ]; then
  T=$(curl -s -m 30 -X POST "$H/gsql/v1/tokens" -H "Content-Type: application/json" -d "{\"secret\":\"$S\",\"lifetime\":\"3600\"}" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).token||'')}catch{console.log('')}})")
  say "token from TG_SECRET" "$([ -n "$T" ] && echo 'yes (valid 1 hour)' || echo 'NO (secret rejected or expired)')"
elif [ -n "$TOK" ]; then T="$TOK"; say "token from TG_API_TOKEN" "using it"
elif [ -n "$U" ] && [ -n "$P" ]; then say "credential" "username/password (basic auth)"
else say "credential" "NONE set (fill TG_SECRET in .env)"; exit 3; fi

if [ -n "$T" ]; then AUTH=(-H "Authorization: Bearer $T"); else AUTH=(-u "$U:$P"); fi

v=$(curl -s -m 30 "$H/restpp/version" "${AUTH[@]}" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const d=JSON.parse(s);const m=/TigerGraph version: (\\S+)/.exec(d.message||'');console.log(d.error?'error: '+(d.message||'').slice(0,80):(m?m[1]:'ok'))}catch{console.log('unparseable')}})")
say "REST++ authenticated" "$v"
case "$v" in error*|unparseable) exit 4;; esac

g=$(curl -s -m 60 -X POST "$H/gsql/v1/statements" "${AUTH[@]}" -H "Content-Type: text/plain" -d "SHOW GRAPH *" | grep -Eo "^- Graph [A-Za-z0-9_]+" | sed 's/- Graph //' | tr '\n' ' ')
say "GSQL works; graphs present" "${g:-none}"
echo "$g" | grep -qw FraudTest && say "FraudTest graph" "exists" || say "FraudTest graph" "not created yet"
echo "$g" | grep -qw FraudGraph && say "FraudGraph graph" "exists" || say "FraudGraph graph" "not created yet"
exit 0
