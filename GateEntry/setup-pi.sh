#!/bin/bash
# ─── Raspberry Pi Gate Entry Setup Script ────────────────
# Run this script on a fresh Raspberry Pi to configure all
# required hardware interfaces and mount the external drive.
#
# Usage: sudo bash setup-pi.sh

set -e

echo ""
echo "═══════════════════════════════════════════"
echo "  Glenridge Gate Entry — Pi Setup"
echo "═══════════════════════════════════════════"
echo ""

# ── Enable SPI (required for MFRC522 RFID reader) ───────
echo "  Enabling SPI interface..."
if ! grep -q "^dtparam=spi=on" /boot/config.txt 2>/dev/null && \
   ! grep -q "^dtparam=spi=on" /boot/firmware/config.txt 2>/dev/null; then
  CONFIG_FILE="/boot/config.txt"
  [ -f /boot/firmware/config.txt ] && CONFIG_FILE="/boot/firmware/config.txt"
  echo "dtparam=spi=on" >> "$CONFIG_FILE"
  echo "  ✓ SPI enabled (reboot required)"
else
  echo "  ✓ SPI already enabled"
fi

# ── Install Node.js (v18 LTS) ───────────────────────────
echo ""
echo "  Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "  Installing Node.js 18..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y nodejs
  echo "  ✓ Node.js $(node -v) installed"
else
  echo "  ✓ Node.js $(node -v) already installed"
fi

# ── Install build tools for native modules ───────────────
echo ""
echo "  Installing build tools..."
apt-get install -y build-essential python3 2>/dev/null
echo "  ✓ Build tools ready"

# ── Mount external USB drive ─────────────────────────────
echo ""
echo "  Setting up external drive mount..."
MOUNT_POINT="/mnt/usb"
DB_DIR="/mnt/usb/gateentry"

mkdir -p "$MOUNT_POINT"

# Find the first USB storage device
USB_DEV=$(lsblk -ndo NAME,TRAN | grep usb | head -1 | awk '{print $1}')
if [ -n "$USB_DEV" ]; then
  USB_PART="/dev/${USB_DEV}1"
  if [ -b "$USB_PART" ]; then
    # Add to fstab if not already there
    if ! grep -q "$MOUNT_POINT" /etc/fstab; then
      UUID=$(blkid -s UUID -o value "$USB_PART")
      echo "UUID=$UUID $MOUNT_POINT ext4 defaults,nofail 0 2" >> /etc/fstab
      echo "  ✓ Added $USB_PART to /etc/fstab"
    fi
    mount -a 2>/dev/null || true
    echo "  ✓ USB drive mounted at $MOUNT_POINT"
  else
    echo "  ⚠ USB partition not found. Format your drive with ext4 first:"
    echo "    sudo mkfs.ext4 /dev/sdX1"
  fi
else
  echo "  ⚠ No USB drive detected. Plug in an ext4-formatted USB drive."
  echo "    The database will be stored at $DB_DIR"
fi

mkdir -p "$DB_DIR"
echo "  ✓ Database directory ready at $DB_DIR"

# ── Create .env file if missing ──────────────────────────
echo ""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  echo "  ✓ Created .env from .env.example"
  echo "  ⚠ IMPORTANT: Edit .env to set WEBSITE_URL and GATE_API_KEY"
else
  echo "  ✓ .env already exists"
fi

# ── Install npm dependencies ────────────────────────────
echo ""
echo "  Installing Node.js dependencies..."
cd "$SCRIPT_DIR"
npm install --production
echo "  ✓ Dependencies installed"

# ── Create systemd service ───────────────────────────────
echo ""
echo "  Creating systemd service..."
cat > /etc/systemd/system/gate-entry.service << EOF
[Unit]
Description=Glenridge Pool Gate Entry Controller
After=network.target local-fs.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gate-entry.service
echo "  ✓ gate-entry.service created and enabled"
echo "    Start with: sudo systemctl start gate-entry"
echo "    View logs:  sudo journalctl -u gate-entry -f"

# ── Summary ──────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo "  Setup Complete!"
echo ""
echo "  Next steps:"
echo "  1. Edit .env — set WEBSITE_URL and GATE_API_KEY"
echo "  2. Reboot (required for SPI): sudo reboot"
echo "  3. After reboot, initialize DB: npm run setup-db"
echo "  4. Start the service: sudo systemctl start gate-entry"
echo "═══════════════════════════════════════════"
echo ""
