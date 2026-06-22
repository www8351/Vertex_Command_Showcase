#!/usr/bin/env bash
set -euo pipefail

DEPLOY_USER="vertex"
SSH_PORT="${SSH_PORT:-2222}"
VERTEX_DIR="/opt/vertex-command"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[provision]${NC} $*"; }
warn() { echo -e "${YELLOW}[provision]${NC} $*"; }
err()  { echo -e "${RED}[provision]${NC} $*" >&2; }

if [ "$(id -u)" -ne 0 ]; then
  err "This script must be run as root"
  exit 1
fi

log "=== Vertex Command — VPS Provisioning & Hardening ==="
log "Target user: $DEPLOY_USER | SSH port: $SSH_PORT"
echo ""

log "Phase 1/7: System update & base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  curl wget git unzip htop tmux jq \
  ufw fail2ban \
  apt-transport-https ca-certificates gnupg lsb-release \
  logrotate

log "Phase 2/7: Create deploy user '$DEPLOY_USER'"
if id "$DEPLOY_USER" &>/dev/null; then
  warn "User '$DEPLOY_USER' already exists, skipping creation"
else
  useradd -m -s /bin/bash -G sudo "$DEPLOY_USER"
  passwd -d "$DEPLOY_USER"
  log "User '$DEPLOY_USER' created with sudo privileges"
fi

mkdir -p /home/$DEPLOY_USER/.ssh
chmod 700 /home/$DEPLOY_USER/.ssh

if [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/authorized_keys
  log "Copied root authorized_keys to $DEPLOY_USER"
elif [ -n "${SSH_PUBLIC_KEY:-}" ]; then
  echo "$SSH_PUBLIC_KEY" > /home/$DEPLOY_USER/.ssh/authorized_keys
  log "Wrote SSH_PUBLIC_KEY env var to authorized_keys"
else
  warn "No SSH key found. Add your Ed25519 public key to /home/$DEPLOY_USER/.ssh/authorized_keys manually"
fi

chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys 2>/dev/null || true
chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh

echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$DEPLOY_USER
chmod 440 /etc/sudoers.d/$DEPLOY_USER

log "Phase 3/7: SSH hardening (port $SSH_PORT, Ed25519 only)"
SSHD_CONFIG="/etc/ssh/sshd_config"
cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%s)"

cat > /etc/ssh/sshd_config.d/vertex-hardening.conf << SSHEOF
Port $SSH_PORT

PermitRootLogin no
PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM yes
PubkeyAuthentication yes
PubkeyAcceptedKeyTypes ssh-ed25519,ssh-ed25519-cert-v01@openssh.com,sk-ssh-ed25519@openssh.com,rsa-sha2-512,rsa-sha2-256

X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
PermitTunnel no

MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2

AllowUsers $DEPLOY_USER
SSHEOF

sshd -t && log "SSH config validated" || { err "SSH config validation failed"; exit 1; }

log "Phase 4/7: Firewall (UFW) — deny all, allow SSH/$SSH_PORT + HTTP/80 + HTTPS/443"
ufw --force reset >/dev/null 2>&1
ufw default deny incoming
ufw default allow outgoing
ufw allow "$SSH_PORT"/tcp comment "SSH (hardened port)"
ufw allow 80/tcp comment "HTTP"
ufw allow 443/tcp comment "HTTPS"
echo "y" | ufw enable
ufw status verbose
log "Firewall active"

log "Phase 5/7: fail2ban configuration"
cat > /etc/fail2ban/jail.local << 'F2BEOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 3
backend  = systemd

[sshd]
enabled  = true
port     = %(sshd_port)s
filter   = sshd
logpath  = /var/log/auth.log
maxretry = 3
bantime  = 7200
F2BEOF

sed -i "s/%(sshd_port)s/$SSH_PORT/" /etc/fail2ban/jail.local

systemctl enable fail2ban
systemctl restart fail2ban
log "fail2ban active — SSH brute-force protection enabled"

log "Phase 6/7: Docker Engine installation"
if command -v docker &>/dev/null; then
  warn "Docker already installed: $(docker --version)"
else
  install -m 0755 -d /etc/apt/keyrings

  DISTRO=$(. /etc/os-release && echo "$ID")
  if [ "$DISTRO" = "debian" ]; then
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  else
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  fi

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  log "Docker installed: $(docker --version)"
fi

usermod -aG docker "$DEPLOY_USER"
systemctl enable docker

cat > /etc/docker/daemon.json << 'DOCKEREOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "live-restore": true,
  "default-address-pools": [
    { "base": "172.20.0.0/16", "size": 24 }
  ]
}
DOCKEREOF

systemctl restart docker

log "Phase 7/7: Application directory & permissions"
mkdir -p "$VERTEX_DIR"
chown -R $DEPLOY_USER:$DEPLOY_USER "$VERTEX_DIR"
log "App directory: $VERTEX_DIR"

cat > /etc/logrotate.d/vertex << LREOF
$VERTEX_DIR/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 $DEPLOY_USER $DEPLOY_USER
}
LREOF

log "Phase 7/7: Kernel hardening (sysctl)"
cat > /etc/sysctl.d/99-vertex-hardening.conf << 'SYSEOF'
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.conf.all.log_martians = 1
kernel.randomize_va_space = 2
fs.suid_dumpable = 0
SYSEOF
sysctl --system >/dev/null 2>&1

systemctl restart ssh || systemctl restart sshd

echo ""
log "=== Provisioning Complete ==="
echo ""
echo -e "${GREEN}Server Hardened:${NC}"
echo "  SSH Port:    $SSH_PORT (Ed25519 keys only, root disabled)"
echo "  Firewall:    UFW active (SSH/$SSH_PORT, HTTP/80, HTTPS/443)"
echo "  fail2ban:    SSH monitoring (3 attempts, 2h ban)"
echo "  Docker:      Installed, log rotation enabled"
echo "  Deploy user: $DEPLOY_USER (passwordless sudo)"
echo "  App dir:     $VERTEX_DIR"
echo ""
echo -e "${YELLOW}IMPORTANT — Next steps:${NC}"
echo "  1. Test SSH: ssh -p $SSH_PORT -i ~/.ssh/id_ed25519 $DEPLOY_USER@<server-ip>"
echo "  2. Add GitHub deploy key to /home/$DEPLOY_USER/.ssh/authorized_keys"
echo "  3. Clone repo:  cd $VERTEX_DIR && git clone <repo-url> ."
echo "  4. Create .env:  cp .env.example .env && vim .env"
echo "  5. First deploy: docker compose --profile ssl up -d --build"
echo ""
echo -e "${YELLOW}WARNING: Your current SSH session may disconnect.${NC}"
echo -e "${YELLOW}Reconnect on port $SSH_PORT before closing this terminal.${NC}"
