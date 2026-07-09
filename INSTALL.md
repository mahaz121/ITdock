# ITDock Installation Guide

Complete installation instructions for **ITDock** - IT Asset Management System

---

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Installation Methods](#installation-methods)
   - [Option A: Ubuntu 24.04 (Non-Docker)](#option-a-ubuntu-2404-non-docker)
   - [Option B: Docker Compose](#option-b-docker-compose)
3. [Environment Configuration](#environment-configuration)
4. [Database Setup](#database-setup)
5. [Running the Application](#running-the-application)
6. [Production Deployment](#production-deployment)
7. [Database Backup & Restore](#database-backup--restore)
8. [Default Credentials](#default-credentials)

---

## Prerequisites

### System Requirements
- Ubuntu 24.04 LTS (recommended) or compatible Linux distribution
- 2GB RAM minimum (4GB recommended)
- 10GB disk space
- Internet connection

---

## Installation Methods

### Option A: Ubuntu 24.04 (Non-Docker)

#### Step 1: Update System
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

#### Step 2: Install Node.js 20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Should show v20.x.x
npm --version
```

#### Step 3: Install MongoDB 7
```bash
# Import MongoDB GPG key
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
  https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Install MongoDB
sudo apt update && sudo apt install -y mongodb-org

# Start and enable MongoDB
sudo systemctl enable mongod
sudo systemctl start mongod
sudo systemctl status mongod
```

#### Step 4: Clone Repository
```bash
git clone <your-repository-url>
cd itdock
```

#### Step 5: Install Dependencies
```bash
npm install
# or use yarn
yarn install
```

#### Step 6: Configure Environment
Create a `.env` file in the project root:
```bash
cp .env.example .env
# Edit the .env file with your configuration (see Environment Configuration section)
nano .env
```

#### Step 7: Build Application
```bash
npm run build
```

#### Step 8: Start Application
```bash
# Development mode
npm run dev

# Production mode
npm start
```

---

### Option B: Docker Compose

#### Step 1: Install Docker & Docker Compose
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose (if not included)
sudo apt install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

#### Step 2: Clone Repository
```bash
git clone <your-repository-url>
cd itdock
```

#### Step 3: Configure Environment
```bash
cp .env.example .env
# Edit the .env file with your configuration
nano .env
```

#### Step 4: Start Services
```bash
# Build and start all services
docker compose up -d --build

# View logs
docker compose logs -f

# Check status
docker compose ps
```

#### Step 5: Stop Services
```bash
docker compose down
```

---

## Environment Configuration

### Required Environment Variables

Create a `.env` file with the following configuration:

```env
# Database Configuration
MONGO_URL=mongodb://localhost:27017
DB_NAME=itdock

# Application Configuration
NEXT_PUBLIC_BASE_URL=http://localhost:3000
CORS_ORIGINS=*

# Security
JWT_SECRET=your-secure-random-secret-key-min-32-chars-change-this-in-production

# File Upload
UPLOAD_DIR=/app/uploads
```

### Environment Variables Explained

- **MONGO_URL**: MongoDB connection string
  - Local: `mongodb://localhost:27017`
  - With auth: `mongodb://username:password@localhost:27017/itdock?authSource=itdock`
  
- **DB_NAME**: Database name (default: `itdock`)

- **NEXT_PUBLIC_BASE_URL**: Your application URL
  - Development: `http://localhost:3000`
  - Production: `https://your-domain.com`

- **JWT_SECRET**: Secret key for JWT token generation (minimum 32 characters)
  - Generate secure key: `openssl rand -base64 32`

- **UPLOAD_DIR**: Directory for file uploads (custody documents)

---

## Database Setup

### Option 1: Local MongoDB (No Authentication)
For development/testing purposes:
```bash
# MongoDB URL without authentication
MONGO_URL=mongodb://localhost:27017
```

### Option 2: MongoDB with Authentication (Recommended for Production)
```bash
# Connect to MongoDB
mongosh

# Create database and user
use itdock
db.createUser({
  user: "itdock_user",
  pwd: "YOUR_SECURE_PASSWORD",
  roles: [{ role: "readWrite", db: "itdock" }]
})
exit

# Update .env file
MONGO_URL=mongodb://itdock_user:YOUR_SECURE_PASSWORD@localhost:27017/itdock?authSource=itdock
```

### Database Collections
ITDock automatically creates the following collections on first run:
- `users` - System users with role-based access
- `employees` - Employee records
- `assets` - Asset inventory
- `assignments` - Asset-to-employee assignments
- `maintenance` - Maintenance records
- `activity_logs` - Asset activity history
- `audit_logs` - System audit trail
- `companies` - Company master data
- `projects` - Project master data
- `locations` - Location master data
- `departments` - Department master data

---

## Running the Application

### Development Mode
```bash
npm run dev
# Application will be available at http://localhost:3000
```

### Production Mode
```bash
# Build the application
npm run build

# Start production server
npm start
```

### Using PM2 (Recommended for Production)
```bash
# Install PM2 globally
npm install -g pm2

# Start application with PM2
pm2 start npm --name "itdock" -- start

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup

# View logs
pm2 logs itdock

# Restart application
pm2 restart itdock

# Stop application
pm2 stop itdock
```

---

## Production Deployment

### NGINX Reverse Proxy Configuration

Create a new NGINX configuration file:
```bash
sudo nano /etc/nginx/sites-available/itdock
```

Add the following configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect HTTP to HTTPS (after SSL setup)
    # return 301 https://$server_name$request_uri;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Increase upload size limit for custody documents
    client_max_body_size 500K;
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/itdock /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### SSL/TLS Certificate (Let's Encrypt)
```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal test
sudo certbot renew --dry-run
```

---

## Database Backup & Restore

### Backup Database
```bash
# Simple backup (no authentication)
mongodump --db itdock --out /backup/$(date +%Y%m%d)

# Backup with authentication
mongodump --uri="mongodb://itdock_user:password@localhost:27017/itdock?authSource=itdock" \
  --out /backup/$(date +%Y%m%d)

# Automated daily backup (add to crontab)
0 2 * * * mongodump --db itdock --out /backup/$(date +\%Y\%m\%d)
```

### Restore Database
```bash
# Simple restore (no authentication)
mongorestore --db itdock /backup/20240101/itdock

# Restore with authentication
mongorestore --uri="mongodb://itdock_user:password@localhost:27017/itdock?authSource=itdock" \
  /backup/20240101/itdock

# Drop existing database before restore
mongorestore --drop --db itdock /backup/20240101/itdock
```

---

## Default Credentials

### Initial Login
On fresh installation, ITDock creates a default super admin account:

```
Username: admin
Password: admin
```

**⚠️ CRITICAL SECURITY WARNING**: 
- Change the default password **immediately** after first login
- The system will prompt you to change the password
- Use a strong password with minimum 8 characters
- Never use default credentials in production

### User Roles
- **Super Admin**: Full system access, user management
- **IT Admin**: Manage assets, employees, assignments
- **IT Technician**: View and update assets, maintenance
- **Viewer**: Read-only access to assets and employees

---

## Troubleshooting

### MongoDB Connection Issues
```bash
# Check MongoDB status
sudo systemctl status mongod

# View MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log

# Restart MongoDB
sudo systemctl restart mongod
```

### Application Not Starting
```bash
# Check if port 3000 is in use
sudo lsof -i :3000

# View application logs (PM2)
pm2 logs itdock

# Restart application
pm2 restart itdock
```

### Health Check
```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Should return:
# {"ok":true,"db":"connected","app":"ITDock"}
```

---

## Additional Resources

- **GitHub Repository**: [Your Repository URL]
- **Documentation**: [Your Docs URL]
- **Issue Tracker**: [Your Issues URL]

---

## License

[Your License Information]

---

**ITDock** - Professional IT Asset Management System
