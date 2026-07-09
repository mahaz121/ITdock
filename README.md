# ITDock - IT Asset Management System

<div align="center">
  
  **Professional IT Asset Management System**
  
  Streamline your IT asset tracking, employee management, and maintenance workflows
</div>

---

## 🚀 Quick Deploy (Ubuntu)

**One-Command Deployment:**

```bash
wget -qO- https://raw.githubusercontent.com/YOUR_USERNAME/itdock/main/direct_deploy.sh | bash
```

Or download and run manually:

```bash
curl -O https://raw.githubusercontent.com/YOUR_USERNAME/itdock/main/direct_deploy.sh
chmod +x direct_deploy.sh
./direct_deploy.sh
```

**What it does:**
- ✅ Installs Git, Node.js 20, MongoDB 7
- ✅ Prompts for repo URL and passwords
- ✅ Clones repo to `~/itdock`
- ✅ Runs `npm install` & `npm run build`
- ✅ Starts with PM2 (auto-restart on reboot)
- ✅ Sets up MongoDB authentication
- ✅ Creates secure JWT secret
- ✅ Updates admin password

**After deployment:**
- Access: `http://YOUR_SERVER_IP:3000`
- Username: `admin`
- Password: (what you entered during setup)

---

## 🎯 Overview

ITDock is a comprehensive IT Asset Management System designed for organizations to efficiently manage their IT assets, employees, assignments, maintenance, and more. Built with modern web technologies, ITDock provides a robust, scalable solution for IT departments.

### Key Features

- ✅ **Role-Based Access Control (RBAC)**
  - Super Admin, IT Admin, IT Technician, Viewer roles
  - Granular permission management
  
- 👥 **Employee Management**
  - Complete CRUD operations
  - Department, location, project assignment
  - Manager hierarchy with circular prevention
  - Vacation and resignation workflows
  
- 🖥️ **Asset Management**
  - Physical and consumable assets
  - Category-specific validation (serial numbers, connection types)
  - Warranty tracking and expiry alerts
  - Scrap management with audit trail
  
- 🔄 **Assignment System**
  - Assign/unassign assets to employees
  - Vacation handover workflow
  - Bulk unassignment for resignations
  - Assignment history and tracking
  
- 🔧 **Maintenance Tracking**
  - Maintenance records and history
  - Activity logs per asset
  - Scheduled maintenance alerts
  
- 📊 **Dashboard & Analytics**
  - Real-time statistics
  - Stock breakdown by category
  - Notification system for expiring items
  - Visual charts and insights
  
- 🏢 **Master Data Management**
  - Companies, Projects, Locations, Departments
  - Hierarchical data with dependency validation
  
- 📁 **Custody Documents**
  - Upload and manage custody documents
  - 500KB file size limit
  - Automatic cleanup on unassignment
  
- 📋 **Audit Logging**
  - Complete audit trail for all operations
  - User action tracking
  - Detailed change history
  
- 📤 **CSV Export**
  - Export asset data with all details
  - Warranty status, assignments included

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ LTS
- MongoDB 7+
- 2GB RAM minimum (4GB recommended)

### Installation

For detailed installation instructions, please see **[INSTALL.md](./INSTALL.md)**

#### Quick Setup (Ubuntu 24.04)
```bash
# Clone repository
git clone <your-repository-url>
cd itdock

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Build and run
npm run build
npm start
```

#### Docker Compose Setup
```bash
# Clone repository
git clone <your-repository-url>
cd itdock

# Configure environment
cp .env.example .env

# Start services
docker compose up -d --build

# View logs
docker compose logs -f app
```

---

## 📖 Documentation

- **[Installation Guide](./INSTALL.md)** - Complete installation instructions for Ubuntu and Docker
- **Default Credentials**: `admin` / `admin` (⚠️ Change immediately after first login!)

---

## 🛠️ Technology Stack

### Frontend
- **Next.js 14** - React framework with server-side rendering
- **React 18** - UI library
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - Re-usable UI components
- **Radix UI** - Accessible component primitives
- **Recharts** - Charting library

### Backend
- **Next.js API Routes** - Serverless API endpoints
- **MongoDB 7** - NoSQL database
- **JWT** - Authentication tokens
- **bcryptjs** - Password hashing

### Development
- **Node.js 20 LTS** - JavaScript runtime
- **Yarn** - Package manager

---

## 📁 Project Structure

```
/app
├── app/
│   ├── api/[[...path]]/route.js    # Backend API routes
│   ├── page.js                      # Frontend application
│   ├── layout.js                    # App layout
│   └── globals.css                  # Global styles
├── components/                      # React components
│   └── ui/                         # UI components (shadcn)
├── lib/
│   ├── db.js                       # MongoDB connection
│   ├── auth.js                     # Authentication utilities
│   └── utils.js                    # Helper functions
├── uploads/                        # Custody documents
├── .env                            # Environment variables
├── .env.example                    # Environment template
├── Dockerfile                      # Docker configuration
├── docker-compose.yml              # Docker Compose setup
├── INSTALL.md                      # Installation guide
└── README.md                       # This file
```

---

## 🔐 Security

### Authentication
- JWT-based authentication
- Secure password hashing with bcryptjs
- Token expiration (7 days default)

### Authorization
- Role-based access control (RBAC)
- Route-level permission checks
- Action-level permission validation

### Best Practices
- ⚠️ **Change default credentials immediately**
- 🔑 Use strong JWT secret (minimum 32 characters)
- 🔒 Enable MongoDB authentication in production
- 🌐 Configure CORS properly for your domain
- 📝 Regular database backups
- 🔄 Keep dependencies updated

---

## 📊 API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user

### Users (Super Admin only)
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Employees
- `GET /api/employees` - List employees
- `GET /api/employees/:id` - Get employee details
- `POST /api/employees` - Create employee
- `PUT /api/employees/:id` - Update employee

### Assets
- `GET /api/assets` - List assets
- `GET /api/assets/:id` - Get asset details
- `POST /api/assets` - Create asset
- `PUT /api/assets/:id` - Update asset
- `POST /api/assets/scrap` - Scrap asset
- `POST /api/assets/renew` - Renew consumable asset

### Assignments
- `GET /api/assignments` - List assignments
- `POST /api/assignments` - Assign asset
- `POST /api/assignments/unassign` - Unassign asset
- `POST /api/assignments/bulk-unassign` - Bulk unassign
- `POST /api/assignments/custody` - Upload custody document
- `POST /api/assignments/custody/delete` - Delete custody document

### Master Data
- `GET /api/companies`, `POST /api/companies`, `PUT /api/companies/:id`, `DELETE /api/companies/:id`
- `GET /api/projects`, `POST /api/projects`, `PUT /api/projects/:id`, `DELETE /api/projects/:id`
- `GET /api/locations`, `POST /api/locations`, `PUT /api/locations/:id`, `DELETE /api/locations/:id`
- `GET /api/departments`, `POST /api/departments`, `PUT /api/departments/:id`, `DELETE /api/departments/:id`

### Filters & Dropdowns
- `GET /api/filters` - Get all filter options
- `GET /api/managers` - Get manager list

### Dashboard
- `GET /api/dashboard/stats` - Dashboard statistics
- `GET /api/dashboard/stock` - Stock breakdown
- `GET /api/dashboard/notifications` - System notifications

### Maintenance & Audit
- `GET /api/maintenance` - List maintenance records
- `POST /api/maintenance` - Create maintenance record
- `GET /api/audit` - View audit log

### Export
- `GET /api/export/assets` - Export assets as CSV

### Health Check
- `GET /api/health` - Service health status

---

## 🔧 Configuration

### Environment Variables

See [.env.example](./.env.example) for all available configuration options.

Key variables:
- `MONGO_URL` - MongoDB connection string
- `DB_NAME` - Database name
- `JWT_SECRET` - Secret for JWT signing
- `NEXT_PUBLIC_BASE_URL` - Application URL
- `UPLOAD_DIR` - Upload directory path

---

## 🐳 Docker Deployment

### Build and Run
```bash
# Build image
docker compose build

# Start services
docker compose up -d

# View logs
docker compose logs -f app

# Stop services
docker compose down

# Stop and remove volumes
docker compose down -v
```

### Health Checks
```bash
# Check application health
curl http://localhost:3000/api/health

# Expected response:
# {"ok":true,"db":"connected","app":"ITDock"}
```

---

## 🧪 Testing

### Backend Testing
```bash
# Test health endpoint
curl http://localhost:3000/api/health

# Test login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin","password":"admin"}'
```

---

## 📝 License

[Your License Here]

---

## 👥 Author


---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

---

## 🌟 Support

If you find this project useful, please consider giving it a star ⭐️

---

**ITDock** - Efficient IT Asset Management Made Simple
