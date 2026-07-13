# ITDock Linux Installation Guide

This guide installs ITDock directly on Ubuntu 24.04 LTS. It uses MongoDB as a
system service, PM2 to keep the Next.js process running, and optionally NGINX
with Let's Encrypt for HTTPS.

## 1. Before you begin

You need:

- A fresh Ubuntu 24.04 LTS server
- A user with `sudo` access
- 2 GB RAM minimum; 4 GB recommended
- 10 GB or more of available disk space
- A domain name pointed to the server for HTTPS deployment
- The Git URL of this repository

The commands support `amd64` and `arm64`.

## 2. Install system packages

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git build-essential openssl
```

## 3. Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs

node --version
npm --version
```

`node --version` should report version 20.

## 4. Install MongoDB Community 8.0

Import the MongoDB signing key and add the Ubuntu 24.04 (`noble`) repository:

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc |
  sudo gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg

echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" |
  sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list

sudo apt update
sudo apt install -y mongodb-org
sudo systemctl enable --now mongod
```

Verify the service:

```bash
sudo systemctl status mongod --no-pager
mongosh --quiet --eval 'db.adminCommand({ ping: 1 })'
```

## 5. Download ITDock

Choose an installation directory and clone ITDock:

```bash
sudo mkdir -p /opt/itdock
sudo chown "$USER":"$USER" /opt/itdock
git clone https://github.com/mahaz121/ITdock.git /opt/itdock
cd /opt/itdock
```

If you downloaded a ZIP instead, extract it and run the remaining commands from
the directory containing `package.json`.

## 6. Install application dependencies

```bash
cd /opt/itdock
npm ci
```

Use `npm ci` for deployments because it installs the versions recorded in
`package-lock.json`.

## 7. Create persistent upload storage

```bash
sudo mkdir -p /var/lib/itdock/uploads
sudo chown -R "$USER":"$USER" /var/lib/itdock
chmod 750 /var/lib/itdock/uploads
```

Uploads are not stored in MongoDB. Back up this directory together with the
database.

## 8. Configure the environment

Create the application configuration:

```bash
cd /opt/itdock
cp .env.example .env
nano .env
```

For an initial local-only installation, use:

```dotenv
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=itdock
JWT_SECRET=REPLACE_WITH_A_RANDOM_SECRET
API_KEY_SALT=REPLACE_WITH_A_DIFFERENT_RANDOM_SECRET
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=REPLACE_WITH_A_STRONG_UNIQUE_PASSWORD
APP_URL=http://SERVER_IP:3000
NEXT_PUBLIC_BASE_URL=http://SERVER_IP:3000
UPLOAD_DIR=/var/lib/itdock/uploads
NODE_ENV=production
```

Generate the two secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Paste a different generated value into each setting. Replace `SERVER_IP` with
the server's address. For a domain deployment, use the final HTTPS URL for both
`NEXT_PUBLIC_BASE_URL` and `APP_URL`.

Protect the configuration file:

```bash
chmod 600 /opt/itdock/.env
```

## 9. Build ITDock

```bash
cd /opt/itdock
npm run build
```

The build must finish successfully before continuing.

## 10. Test the application

Start ITDock temporarily:

```bash
npm start
```

From a second terminal, run:

```bash
curl http://127.0.0.1:3000/api/health
```

The response should include:

```json
{"ok":true,"db":"connected"}
```

Press `Ctrl+C` in the first terminal after the test.

## 11. Run ITDock with PM2

Install PM2 and start the production server:

```bash
sudo npm install -g pm2
cd /opt/itdock
pm2 start npm --name itdock --cwd /opt/itdock -- start
pm2 save
pm2 startup
```

`pm2 startup` prints one command beginning with `sudo`. Copy and execute that
exact command, then run:

```bash
pm2 save
pm2 status
curl http://127.0.0.1:3000/api/health
```

Useful PM2 commands:

```bash
pm2 logs itdock
pm2 restart itdock
pm2 stop itdock
pm2 status
```

## 12. First sign-in

Open:

```text
http://SERVER_IP:3000
```

Initial credentials:

Sign in with the `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` values. The
bootstrap account is created only when the users collection is empty. Remove
`INITIAL_ADMIN_PASSWORD` from the environment immediately after first startup.

## 13. Recommended production setup

### Enable MongoDB authentication

Create a database user before enabling authorization:

```bash
mongosh
```

Run the following in `mongosh`, replacing the password:

```javascript
use itdock
db.createUser({
  user: "itdock_app",
  pwd: "REPLACE_WITH_A_STRONG_DATABASE_PASSWORD",
  roles: [{ role: "readWrite", db: "itdock" }]
})
exit
```

Edit MongoDB configuration:

```bash
sudo nano /etc/mongod.conf
```

Add or update:

```yaml
security:
  authorization: enabled
```

Restart MongoDB:

```bash
sudo systemctl restart mongod
```

Update `/opt/itdock/.env`:

```dotenv
MONGO_URL=mongodb://itdock_app:URL_ENCODED_PASSWORD@127.0.0.1:27017/itdock?authSource=itdock
```

If the password contains characters such as `@`, `:`, `/`, `?`, or `#`, URL
encode it before placing it in the connection URI.

Verify and restart:

```bash
mongosh "mongodb://itdock_app:URL_ENCODED_PASSWORD@127.0.0.1:27017/itdock?authSource=itdock" --quiet --eval 'db.runCommand({ ping: 1 })'
pm2 restart itdock
curl http://127.0.0.1:3000/api/health
```

### Install NGINX

```bash
sudo apt install -y nginx
sudo nano /etc/nginx/sites-available/itdock
```

Use this configuration, replacing the domain:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name itdock.example.com;

    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/itdock /etc/nginx/sites-enabled/itdock
sudo nginx -t
sudo systemctl reload nginx
```

Set these values in `/opt/itdock/.env`:

```dotenv
NEXT_PUBLIC_BASE_URL=https://itdock.example.com
APP_URL=https://itdock.example.com
```

### Enable HTTPS

Make sure the domain resolves to this server, then run:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d itdock.example.com
sudo certbot renew --dry-run
pm2 restart itdock
```

### Configure the firewall

When NGINX is in use, expose SSH and HTTPS—not MongoDB or port 3000:

```bash
sudo ufw allow OpenSSH
sudo ufw allow "Nginx Full"
sudo ufw enable
sudo ufw status
```

Do not expose port `27017` publicly.

## 14. Updating ITDock

Back up the service first, then:

```bash
cd /opt/itdock
git pull --ff-only
npm ci
npm run build
pm2 restart itdock
curl http://127.0.0.1:3000/api/health
```

If the build fails, do not restart the running PM2 process.

## 15. Backup and restore

### Backup

```bash
sudo mkdir -p /var/backups/itdock
sudo mongodump --db itdock --out "/var/backups/itdock/db-$(date +%F-%H%M%S)"
sudo tar -czf "/var/backups/itdock/uploads-$(date +%F-%H%M%S).tar.gz" -C /var/lib/itdock uploads
```

For an authenticated database, provide its MongoDB URI:

```bash
sudo mongodump \
  --uri="mongodb://itdock_app:URL_ENCODED_PASSWORD@127.0.0.1:27017/itdock?authSource=itdock" \
  --out="/var/backups/itdock/db-$(date +%F-%H%M%S)"
```

### Restore

Stop ITDock before restoring:

```bash
pm2 stop itdock
mongorestore --drop --db itdock /var/backups/itdock/DB_BACKUP_DIRECTORY/itdock
sudo tar -xzf /var/backups/itdock/UPLOAD_BACKUP.tar.gz -C /var/lib/itdock
pm2 start itdock
```

Test backup restoration regularly and keep an off-server copy.

## 16. Troubleshooting

### Application health

```bash
curl -i http://127.0.0.1:3000/api/health
pm2 status
pm2 logs itdock --lines 100
```

### MongoDB

```bash
sudo systemctl status mongod --no-pager
sudo journalctl -u mongod -n 100 --no-pager
mongosh --quiet --eval 'db.adminCommand({ ping: 1 })'
```

### Port conflicts

```bash
sudo ss -ltnp | grep -E ':3000|:27017'
```

### NGINX 502 response

```bash
pm2 status
curl http://127.0.0.1:3000/api/health
sudo nginx -t
sudo tail -n 100 /var/log/nginx/error.log
```

### Upload failures

```bash
ls -ld /var/lib/itdock/uploads
df -h
sudo chown -R "$USER":"$USER" /var/lib/itdock
chmod 750 /var/lib/itdock/uploads
```

The reverse proxy limit must be at least 10 MB; this guide configures 12 MB.

## 17. Production checklist

- [ ] One-time administrator bootstrapped and `INITIAL_ADMIN_PASSWORD` removed
- [ ] Unique `JWT_SECRET` configured
- [ ] Unique `API_KEY_SALT` configured
- [ ] `.env` permissions set to `600`
- [ ] MongoDB authentication enabled
- [ ] MongoDB and port 3000 blocked from public access
- [ ] NGINX and HTTPS configured
- [ ] `APP_URL` set to the canonical HTTPS origin
- [ ] MongoDB backups scheduled and tested
- [ ] `/var/lib/itdock/uploads` included in backups
- [ ] OS and npm security updates reviewed regularly

## Docker note

The current `docker-compose.yml` runs only the ITDock application and uses host
networking to reach a MongoDB service already installed on the Linux host. It
does not create a MongoDB container. For that reason, the direct Ubuntu method
above is the recommended and fully documented installation path.
