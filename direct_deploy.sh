#!/bin/bash
set -e

echo "=========================================="
echo "ITDock Direct Deployment Script"
echo "=========================================="

# Prompt for inputs
read -p "Enter GitHub Repo URL: " GITHUB_REPO_URL
read -sp "Enter MongoDB Admin Password: " DB_PASSWORD
echo ""
read -sp "Enter ITDock Admin Password: " ADMIN_PASSWORD
echo ""

# Validate inputs
if [ -z "$GITHUB_REPO_URL" ] || [ -z "$DB_PASSWORD" ] || [ -z "$ADMIN_PASSWORD" ]; then
    echo "Error: All fields are required!"
    exit 1
fi
if [[ "$DB_PASSWORD$ADMIN_PASSWORD" == *$'\n'* ]] || [[ ! "$GITHUB_REPO_URL" =~ ^(https://|git@github\.com:) ]]; then
    echo "Error: invalid repository URL or newline in a password"
    exit 1
fi

echo ""
echo "Installing dependencies..."

# Update system
sudo apt update && sudo apt upgrade -y

# Install Git
sudo apt install -y git

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install MongoDB 7
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod

# Configure MongoDB with authentication
echo "Configuring MongoDB..."
ITDOCK_DB_PASSWORD="$DB_PASSWORD" mongosh admin --eval "
db.createUser({
  user: 'itdock_admin',
  pwd: process.env.ITDOCK_DB_PASSWORD,
  roles: [{ role: 'readWrite', db: 'itdock' }]
})
"

# Enable MongoDB authentication
sudo sed -i 's/#security:/security:\n  authorization: enabled/' /etc/mongod.conf
sudo systemctl restart mongod

# Clone repository
echo "Cloning repository..."
rm -rf ~/itdock
git clone "$GITHUB_REPO_URL" ~/itdock
cd ~/itdock

# Create .env file
echo "Creating .env file..."
JWT_SECRET=$(openssl rand -base64 32)
API_KEY_SALT=$(openssl rand -base64 32)
ENCODED_DB_PASSWORD=$(ITDOCK_DB_PASSWORD="$DB_PASSWORD" node -e "process.stdout.write(encodeURIComponent(process.env.ITDOCK_DB_PASSWORD))")
PUBLIC_URL=http://$(hostname -I | awk '{print $1}'):3000
umask 077
cat > .env << EOF
MONGO_URL=mongodb://itdock_admin:${ENCODED_DB_PASSWORD}@localhost:27017/itdock?authSource=admin
DB_NAME=itdock
NEXT_PUBLIC_BASE_URL=${PUBLIC_URL}
APP_URL=${PUBLIC_URL}
JWT_SECRET=${JWT_SECRET}
API_KEY_SALT=${API_KEY_SALT}
INITIAL_ADMIN_EMAIL=admin
INITIAL_ADMIN_PASSWORD=${ADMIN_PASSWORD}
UPLOAD_DIR=/home/$(whoami)/itdock/uploads
EOF

# Create uploads directory
mkdir -p uploads

# Install dependencies
echo "Installing Node.js dependencies..."
npm ci

# Build application
echo "Building application..."
npm run build

# Install PM2 globally
sudo npm install -g pm2

# Start application with PM2
echo "Starting ITDock with PM2..."
pm2 delete itdock 2>/dev/null || true
pm2 start npm --name "itdock" -- start
pm2 save
pm2 startup | tail -n 1 | bash

# Display info
IP_ADDR=$(hostname -I | awk '{print $1}')
echo ""
echo "=========================================="
echo "ITDock Deployed Successfully!"
echo "=========================================="
echo "Access URL: http://$IP_ADDR:3000"
echo "Username: admin"
echo "The administrator password was not printed. Store it in your password manager."
echo ""
echo "Commands:"
echo "  pm2 status       - Check app status"
echo "  pm2 logs itdock  - View logs"
echo "  pm2 restart itdock - Restart app"
echo "=========================================="
