#!/usr/bin/env bash
# provision-vultr.sh — Provision + harden the Vertex Command production VPS on Vultr.
#
# Drives the Vultr API v2 (curl-equivalent via Python urllib — no jq/vultr-cli needed):
#   1. Query plans, pick cheapest with >= 2 vCPU and >= 4096 MB RAM available in REGION
#   2. Pick Ubuntu 24.04 LTS x64 (fallback Debian 12 x64)
#   3. Upsert the local Ed25519 public key as a Vultr SSH key
#   4. Create the instance, poll until status=active + IP assigned
#   5. Wait for sshd on :22, run health check, pipe provision.sh as root
#   6. Verify hardened access on :2222 as the 'vertex' user, print connection string
#
# Auth: set VULTR_API_KEY env, OR put the key (only) in ~/.vultr_token
#   NOTE: Vultr API has an IP allowlist (Account > API). Add this machine's public IP
#         (or 0.0.0.0/0) there, or every call returns HTTP 403.
#
# Region: defaults to ewr (New Jersey, US East — lowest latency to NY brokers).
#         Override:  REGION=ord bash provision-vultr.sh   (Chicago / CME Globex)
#
# Re-runnable: skips SSH-key creation if the key already exists. Creating an instance
# twice WILL create two billable instances — pass an existing IP to skip creation:
#   SKIP_CREATE_IP=1.2.3.4 bash provision-vultr.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROVISION_SH="$SCRIPT_DIR/provision.sh"
KEY="$HOME/.ssh/id_ed25519"
PUB="$HOME/.ssh/id_ed25519.pub"
REGION="${REGION:-ewr}"
SSH_PORT="${SSH_PORT:-2222}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[provision-vultr]${NC} $*"; }
warn() { echo -e "${YELLOW}[provision-vultr]${NC} $*"; }
err()  { echo -e "${RED}[provision-vultr]${NC} $*" >&2; }

# --- preflight ----------------------------------------------------------------
: "${VULTR_API_KEY:=$(cat "$HOME/.vultr_token" 2>/dev/null || true)}"
if [ -z "${VULTR_API_KEY:-}" ]; then
  err "No Vultr API key. Set VULTR_API_KEY env or put the key in ~/.vultr_token"
  exit 1
fi
export VULTR_API_KEY
[ -f "$PUB" ]          || { err "Missing public key: $PUB"; exit 1; }
[ -f "$PROVISION_SH" ] || { err "Missing provision.sh: $PROVISION_SH"; exit 1; }
command -v python  >/dev/null 2>&1 || { err "python not found"; exit 1; }
command -v ssh     >/dev/null 2>&1 || { err "ssh not found"; exit 1; }

# --- step 1-4: create instance via Vultr API (Python) -------------------------
IP="${SKIP_CREATE_IP:-}"
if [ -z "$IP" ]; then
  log "Querying Vultr (plans / os / regions) and creating instance in '$REGION'..."
  CREATE_OUT="$(REGION="$REGION" PUB_PATH="$PUB" python - <<'PY'
import json, os, sys, time, urllib.request, urllib.error
API = "https://api.vultr.com/v2"
KEY = os.environ["VULTR_API_KEY"]
REGION = os.environ.get("REGION", "ewr")

def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        "Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        hint = "  (HTTP 403 usually = your IP is not on the Vultr API allowlist: Account > API)" if e.code == 403 else ""
        sys.exit(f"[vultr] API ERROR {e.code} on {method} {path}: {body}{hint}")
    except urllib.error.URLError as e:
        sys.exit(f"[vultr] NETWORK ERROR on {method} {path}: {e}")

def emit(msg): print(msg, file=sys.stderr)

# regions
regions = {r["id"]: r for r in call("GET", "/regions?per_page=500")["regions"]}
if REGION not in regions:
    sys.exit(f"[vultr] region '{REGION}' not available. Options: {','.join(sorted(regions))}")

# plans: >= 2 vCPU, >= 4096 MB, available in REGION, cheapest first
plans = call("GET", "/plans?per_page=500")["plans"]
cand = [p for p in plans if p["vcpu_count"] >= 2 and p["ram"] >= 4096 and REGION in p.get("locations", [])]
if not cand:
    sys.exit(f"[vultr] no plan with >=2vCPU/4GB available in '{REGION}'")
plan = sorted(cand, key=lambda p: p["monthly_cost"])[0]
emit(f"[vultr] plan: {plan['id']} ({plan['vcpu_count']} vCPU / {plan['ram']} MB / {plan['disk']} GB disk) ~${plan['monthly_cost']}/mo")

# os: Ubuntu 24.04 LTS x64, fallback Debian 12 x64
oss = call("GET", "/os?per_page=500")["os"]
pick = [o for o in oss if o["arch"] == "x64" and "Ubuntu 24.04" in o["name"]] \
    or [o for o in oss if o["arch"] == "x64" and "Debian 12" in o["name"]]
if not pick:
    sys.exit("[vultr] no Ubuntu 24.04 / Debian 12 x64 image found")
os_obj = pick[0]
emit(f"[vultr] os: {os_obj['name']} (id={os_obj['id']})")

# ssh key upsert
pub = open(os.environ["PUB_PATH"]).read().strip()
keys = call("GET", "/ssh-keys?per_page=500").get("ssh_keys", [])
match = [k for k in keys if k["ssh_key"].strip() == pub]
sshid = match[0]["id"] if match else call("POST", "/ssh-keys",
    {"name": "vertex-command-deploy", "ssh_key": pub})["ssh_key"]["id"]
emit(f"[vultr] ssh key id: {sshid} ({'reused' if match else 'created'})")

# create instance
inst = call("POST", "/instances", {
    "region": REGION, "plan": plan["id"], "os_id": os_obj["id"],
    "sshkey_id": [sshid], "label": "vertex-command-prod", "hostname": "vertex-command",
    "backups": "disabled", "enable_ipv6": True, "tags": ["vertex-command", "production"],
})["instance"]
iid = inst["id"]
emit(f"[vultr] created instance {iid}; polling for active...")

# poll until active + IP assigned (~10 min max)
ip = "0.0.0.0"
for i in range(120):
    d = call("GET", f"/instances/{iid}")["instance"]
    ip = d.get("main_ip", "0.0.0.0")
    emit(f"[vultr] poll {i:>3}: status={d.get('status')} power={d.get('power_status')} server={d.get('server_status')} ip={ip}")
    if d.get("status") == "active" and d.get("power_status") == "running" and ip and ip != "0.0.0.0":
        break
    time.sleep(5)
else:
    sys.exit(f"[vultr] TIMEOUT waiting for instance {iid} to become active")

print(f"{iid} {ip}")  # stdout: machine-readable result
PY
)"
  INSTANCE_ID="$(echo "$CREATE_OUT" | awk '{print $1}')"
  IP="$(echo "$CREATE_OUT" | awk '{print $2}')"
  log "Instance $INSTANCE_ID is Active. Public IP: $IP"
else
  log "SKIP_CREATE_IP set — using existing IP: $IP"
fi

[ -n "$IP" ] || { err "No public IP resolved"; exit 1; }
echo ""
log "================  PUBLIC IP: $IP  ================"
echo ""

# --- step 5: wait for sshd on :22, health check -------------------------------
SSHOPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i "$KEY")
log "Waiting for sshd on $IP:22 (fresh boot can take a few minutes)..."
READY=0
for i in $(seq 1 60); do
  if ssh "${SSHOPTS[@]}" -o BatchMode=yes "root@$IP" 'echo ok' >/dev/null 2>&1; then
    READY=1; break
  fi
  sleep 5
done
[ "$READY" = 1 ] || { err "sshd never reachable on $IP:22"; exit 1; }

log "Health check (task step 6):"
ssh "${SSHOPTS[@]}" "root@$IP" echo "Server is up"

# --- step 7: pipe provision.sh as root ----------------------------------------
log "Running provision.sh as root (hardening + Docker). Session survives the SSH restart..."
ssh "${SSHOPTS[@]}" "root@$IP" "SSH_PORT='$SSH_PORT' SSH_PUBLIC_KEY='$(cat "$PUB")' bash -s" < "$PROVISION_SH"

# --- verify hardened access on :2222 as vertex --------------------------------
log "Verifying hardened access on $IP:$SSH_PORT as 'vertex'..."
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -i "$KEY" -p "$SSH_PORT" "vertex@$IP" \
  'echo HARDENED_OK; docker --version; sudo ufw status verbose | head -n 8'

echo ""
log "================  PROVISIONING COMPLETE  ================"
echo "Public IP:         $IP"
echo "Connection string: ssh -i ~/.ssh/id_ed25519 -p $SSH_PORT vertex@$IP"
echo ""
warn "Next: deploy the app (rsync repo to /opt/vertex-command, write .env, run infra/vps/deploy.sh)."
warn "Security: root@:22 is now disabled; revoke the Vultr API token if it was a temporary one."
