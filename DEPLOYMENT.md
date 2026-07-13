# ITDock Deployment Guide

This guide provides step-by-step instructions for deploying ITDock to production environments.

---

## Table of Contents
1. [Docker Deployment](#docker-deployment)
2. [Ubuntu VPS Deployment](#ubuntu-vps-deployment)
3. [Production Checklist](#production-checklist)
4. [Troubleshooting](#troubleshooting)

---

## Docker Deployment

### Prerequisites
- Docker 20.10+
- Docker Compose 2.0+
- 2GB RAM minimum (4GB recommended)
- 10GB disk space

### Step 1: Prepare Environment
```bash
# Clone repository
git clone https://github.com/mahaz121/ITdock.git itdock
cd itdock

# Create .env file
cp .env.example .env

# Edit .env file with production values
nano .env
```

### Step 2: Configure Environment Variables
```env
# Production .env configuration
MONGO_URL=mongodb://mongo:27017
DB_NAME=itdock
NEXT_PUBLIC_BASE_URL=https://your-domain.com
APP_URL=https://your-domain.com
JWT_SECRET=<generate-with-openssl-rand-base64-32>
API_KEY_SALT=<generate-with-openssl-rand-base64-32>
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=<one-time-strong-bootstrap-password>
UPLOAD_DIR=/app/uploads
```

### Step 3: Start Services
```bash
# Build and start in detached mode
docker compose up -d --build

# View logs
docker compose logs -f app

# Check status
docker compose ps
```

### Step 4: Verify Deployment
```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Expected response:
# {"ok":true,"db":"connected","app":"ITDock"}
```

### Step 5: Setup Reverse Proxy (NGINX)

Create NGINX configuration:
```bash
sudo nano /etc/nginx/sites-available/itdock
```

Add configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    client_max_body_size 500K;
}
```

Enable and restart NGINX:
```bash
sudo ln -s /etc/nginx/sites-available/itdock /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 6: Setup SSL with Let's Encrypt
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
sudo certbot renew --dry-run
```

### Docker Management Commands
```bash
# View logs
docker compose logs -f app
docker compose logs -f mongo

# Restart services
docker compose restart

# Stop services
docker compose down

# Update and restart
git pull
docker compose up -d --build

# Backup database
docker compose exec mongo mongodump --archive=/data/backup.archive
docker compose cp mongo:/data/backup.archive ./backup.archive

# Restore database
docker compose cp ./backup.archive mongo:/data/backup.archive
docker compose exec mongo mongorestore --archive=/data/backup.archive
```

---

## Ubuntu VPS Deployment

### Prerequisites
- Ubuntu 24.04 LTS
- Root or sudo access
- 2GB RAM minimum (4GB recommended)
- Domain name pointed to server IP

### Step 1: Update System
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential nginx
```

### Step 2: Install Node.js 20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Should show v20.x.x
npm --version
```

### Step 3: Install MongoDB 7
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

# Start MongoDB
sudo systemctl enable mongod
sudo systemctl start mongod
sudo systemctl status mongod
```

### Step 4: Setup MongoDB Authentication (Recommended)
```bash
# Connect to MongoDB
mongosh

# Switch to admin database
use admin

# Create admin user
db.createUser({
  user: "admin",
  pwd: "SecureAdminPassword123",
  roles: [{ role: "userAdminAnyDatabase", db: "admin" }]
})

# Create ITDock database and user
use itdock
db.createUser({
  user: "itdock_user",
  pwd: "SecurePassword123",
  roles: [{ role: "readWrite", db: "itdock" }]
})
exit

# Enable authentication in MongoDB config
sudo nano /etc/mongod.conf

# Add/uncomment:
security:
  authorization: enabled

# Restart MongoDB
sudo systemctl restart mongod
```

### Step 5: Clone and Setup Application
```bash
# Create application directory
sudo mkdir -p /var/www/itdock
cd /var/www/itdock

# Clone repository
sudo git clone https://github.com/mahaz121/ITdock.git .

# Set permissions
sudo chown -R $USER:$USER /var/www/itdock

# Install dependencies
npm install

# Create .env file
cp .env.example .env
nano .env
```

### Step 6: Configure Environment
```env
# Production .env
MONGO_URL=mongodb://itdock_user:SecurePassword123@localhost:27017/itdock?authSource=itdock
DB_NAME=itdock
NEXT_PUBLIC_BASE_URL=https://your-domain.com
APP_URL=https://your-domain.com
JWT_SECRET=<generate-with-openssl-rand-base64-32>
API_KEY_SALT=<generate-with-openssl-rand-base64-32>
UPLOAD_DIR=/var/www/itdock/uploads
```

### Step 7: Build Application
```bash
npm run build
```

### Step 8: Setup PM2 for Process Management
```bash
# Install PM2 globally
sudo npm install -g pm2

# Start application
pm2 start npm --name "itdock" -- start

# Configure PM2 to start on boot
pm2 save
pm2 startup

# Copy and run the command provided by pm2 startup
```

### Step 9: Configure NGINX
```bash
# Create NGINX configuration
sudo nano /etc/nginx/sites-available/itdock
```

Add configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;

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

    client_max_body_size 500K;
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/itdock /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 10: Setup SSL Certificate
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### PM2 Management Commands
```bash
# View logs
pm2 logs itdock

# Restart application
pm2 restart itdock

# Stop application
pm2 stop itdock

# Monitor
pm2 monit

# View status
pm2 status

# Update application
cd /var/www/itdock
git pull
npm install
npm run build
pm2 restart itdock
```

---

## Production Checklist

### Security
- [ ] Bootstrapped a unique administrator and removed `INITIAL_ADMIN_PASSWORD`
- [ ] Generated secure JWT_SECRET (32+ characters)
- [ ] Enabled MongoDB authentication
- [ ] Configured canonical HTTPS `APP_URL`
- [ ] SSL/TLS certificate installed
- [ ] Firewall configured (UFW or iptables)
- [ ] Regular security updates scheduled

### Performance
- [ ] Production build completed successfully
- [ ] Static assets optimized
- [ ] Database indexes created
- [ ] PM2 cluster mode enabled (if needed)
- [ ] NGINX caching configured
- [ ] Log rotation configured

### Monitoring
- [ ] Health endpoint accessible
- [ ] PM2 monitoring setup
- [ ] Log aggregation configured
- [ ] Uptime monitoring (e.g., UptimeRobot)
- [ ] Error tracking (e.g., Sentry)
- [ ] Database backup automated

### Backup
- [ ] Daily database backups scheduled
- [ ] Backup restoration tested
- [ ] Upload directory backed up
- [ ] Off-site backup storage configured

### Environment
- [ ] All environment variables set correctly
- [ ] .env file permissions secured (chmod 600)
- [ ] No sensitive data in version control
- [ ] Upload directory writable
- [ ] Node.js version correct (20+)
- [ ] MongoDB version correct (7+)

---

## Troubleshooting

### Application Won't Start
```bash
# Check PM2 logs
pm2 logs itdock

# Check port availability
sudo lsof -i :3000

# Check MongoDB connection
mongosh --eval "db.adminCommand('ping')"

# Verify environment variables
pm2 show itdock
```

### Database Connection Failed
```bash
# Check MongoDB status
sudo systemctl status mongod

# View MongoDB logs
sudo tail -f /var/log/mongodb/mongod.log

# Test connection
mongosh "mongodb://itdock_user:password@localhost:27017/itdock?authSource=itdock"

# Restart MongoDB
sudo systemctl restart mongod
```

### 502 Bad Gateway (NGINX)
```bash
# Check if application is running
pm2 status

# Check NGINX error logs
sudo tail -f /var/log/nginx/error.log

# Test NGINX configuration
sudo nginx -t

# Restart NGINX
sudo systemctl restart nginx
```

### High Memory Usage
```bash
# Check memory usage
free -h
pm2 monit

# Restart application
pm2 restart itdock

# Enable PM2 cluster mode (use multiple cores)
pm2 delete itdock
pm2 start npm --name "itdock" -i max -- start
```

### Slow Performance
```bash
# Check database indexes
mongosh itdock --eval "db.assets.getIndexes()"
mongosh itdock --eval "db.employees.getIndexes()"

# Create indexes if missing
mongosh itdock --eval 'db.assets.createIndex({ "id": 1 })'
mongosh itdock --eval 'db.employees.createIndex({ "id": 1 })'

# Monitor slow queries
mongosh --eval "db.setProfilingLevel(1, { slowms: 100 })"
```

### File Upload Issues
```bash
# Check upload directory permissions
ls -la /var/www/itdock/uploads

# Set correct permissions
sudo chown -R www-data:www-data /var/www/itdock/uploads
sudo chmod -R 755 /var/www/itdock/uploads

# Check disk space
df -h
```

### Health Check Fails
```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Check MongoDB connectivity
mongosh --eval "db.adminCommand('ping')"

# Verify JWT_SECRET is set
grep JWT_SECRET /var/www/itdock/.env

# Check logs
pm2 logs itdock --lines 100
```

---

## Backup & Restore

### Automated Daily Backup
```bash
# Create backup script
sudo nano /usr/local/bin/backup-itdock.sh
```

Add content:
```bash
#!/bin/bash
BACKUP_DIR="/backup/itdock"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Backup MongoDB
mongodump --uri="mongodb://itdock_user:password@localhost:27017/itdock?authSource=itdock" \
  --out "$BACKUP_DIR/db_$DATE"

# Backup uploads
tar -czf "$BACKUP_DIR/uploads_$DATE.tar.gz" /var/www/itdock/uploads

# Remove backups older than 7 days
find $BACKUP_DIR -type f -mtime +7 -delete

echo "Backup completed: $DATE"
```

Make executable and schedule:
```bash
sudo chmod +x /usr/local/bin/backup-itdock.sh

# Add to crontab (daily at 2 AM)
sudo crontab -e
# Add line:
0 2 * * * /usr/local/bin/backup-itdock.sh >> /var/log/itdock-backup.log 2>&1
```

### Manual Restore
```bash
# Restore database
mongorestore --uri="mongodb://itdock_user:password@localhost:27017/itdock?authSource=itdock" \
  --drop /backup/itdock/db_20240101_020000

# Restore uploads
tar -xzf /backup/itdock/uploads_20240101_020000.tar.gz -C /
```

---

## Updating ITDock

### Docker Deployment
```bash
cd /path/to/itdock
git pull
docker compose down
docker compose up -d --build
```

### Ubuntu VPS Deployment
```bash
cd /var/www/itdock
git pull
npm install
npm run build
pm2 restart itdock
```

---

## Support

For issues and questions:
- GitHub Issues: [Your Issues URL]

---

**ITDock Deployment Guide** - Deploy with Confidence
