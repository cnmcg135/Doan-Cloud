// =================================================================
//                      KHAI BÁO THƯ VIỆN
// =================================================================
const express = require('express');
const sql = require('mssql');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const fs = require('fs');
require('dotenv').config();

// Azure Key Vault imports (with fallback)
let SecretClient, DefaultAzureCredential, ManagedIdentityCredential;
try {
    const keyVaultModule = require('@azure/keyvault-secrets');
    const identityModule = require('@azure/identity');
    SecretClient = keyVaultModule.SecretClient;
    DefaultAzureCredential = identityModule.DefaultAzureCredential;
    ManagedIdentityCredential = identityModule.ManagedIdentityCredential;
    console.log('✅ Azure Key Vault modules loaded');
} catch (error) {
    console.warn('⚠️ Azure Key Vault modules not available, using environment variables only');
}

// Import middleware từ file riêng
const { requireAdmin } = require('./middleware.js');

// =================================================================
//                      GLOBAL ERROR HANDLING (FIRST PRIORITY)
// =================================================================

// Prevent process termination on uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('💀 UNCAUGHT EXCEPTION (but continuing):', err.message);
    console.error('Stack:', err.stack);
    // DON'T exit process - keep running
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💀 UNHANDLED REJECTION (but continuing):', reason);
    // DON'T exit process - keep running
});

// =================================================================
//                      KHỞI TẠO VÀ CẤU HÌNH EXPRESS
// =================================================================
const app = express();
const port = process.env.PORT || 8080; // Azure thường dùng port 8080
const isProduction = process.env.NODE_ENV === 'production';

console.log('🚀 Starting Villa Agency Application...');
console.log('📍 Port:', port);
console.log('🌍 Environment:', isProduction ? 'Production' : 'Development');

// Middleware cơ bản
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy cho Azure
if (isProduction) {
    app.set('trust proxy', 1);
    console.log('✅ Trust proxy enabled for Azure');
}

// =================================================================
//                      AZURE KEY VAULT (WITH ROBUST FALLBACK)
// =================================================================
let keyVaultClient = null;
let secretsCache = {};

async function initializeKeyVault() {
    try {
        if (!SecretClient) {
            console.log('⚠️ Azure Key Vault SDK not available, using environment variables');
            return false;
        }

        const keyVaultUrl = process.env.AZURE_KEY_VAULT_URL;
        
        if (!keyVaultUrl) {
            console.log('⚠️ AZURE_KEY_VAULT_URL not found, using environment variables');
            return false;
        }
        
        console.log('🔐 Initializing Azure Key Vault...');
        console.log('🔑 Key Vault URL:', keyVaultUrl);
        
        let credential;
        if (isProduction) {
            credential = new ManagedIdentityCredential();
            console.log('🔄 Using Managed Identity for production');
        } else {
            credential = new DefaultAzureCredential();
            console.log('🔄 Using Default Azure Credential for development');
        }
        
        keyVaultClient = new SecretClient(keyVaultUrl, credential);
        
        // Test connection với timeout
        console.log('🔄 Testing Key Vault connection...');
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Key Vault connection timeout')), 10000);
        });
        
        await Promise.race([
            keyVaultClient.getSecret('session-secret'),
            timeoutPromise
        ]);
        
        console.log('✅ Azure Key Vault connected successfully');
        return true;
        
    } catch (error) {
        console.error('❌ Key Vault initialization failed:', error.message);
        console.log('⚠️ Falling back to environment variables');
        keyVaultClient = null;
        return false;
    }
}

async function getSecret(secretName, fallbackEnvVar = null) {
    try {
        // Check cache first
        if (secretsCache[secretName]) {
            return secretsCache[secretName];
        }
        
        if (keyVaultClient) {
            console.log(`🔍 Getting secret: ${secretName}`);
            const secret = await keyVaultClient.getSecret(secretName);
            secretsCache[secretName] = secret.value;
            console.log(`✅ Secret retrieved: ${secretName}`);
            return secret.value;
        }
        
        // Fallback to environment variable
        if (fallbackEnvVar && process.env[fallbackEnvVar]) {
            console.log(`🔄 Using env var: ${fallbackEnvVar}`);
            return process.env[fallbackEnvVar];
        }
        
        throw new Error(`Secret ${secretName} not available`);
        
    } catch (error) {
        console.error(`❌ Error getting secret ${secretName}:`, error.message);
        
        // Ultimate fallback
        if (fallbackEnvVar && process.env[fallbackEnvVar]) {
            console.log(`🔄 Ultimate fallback to env var: ${fallbackEnvVar}`);
            return process.env[fallbackEnvVar];
        }
        
        // Return default values for critical secrets
        if (secretName === 'session-secret') {
            console.log('🔄 Using hardcoded session secret fallback');
            return 'cnmcg135-villa-agency-session-secret-2025-07-22-production';
        }
        
        if (secretName === 'default-admin-password') {
            console.log('🔄 Using default admin password');
            return 'admin123';
        }
        
        return null;
    }
}

// =================================================================
//                      SESSION CONFIGURATION (BULLETPROOF)
// =================================================================
async function initializeSession() {
    try {
        console.log('🔄 Initializing session...');
        
        // Get session secret with multiple fallbacks
        let sessionSecret;
        try {
            sessionSecret = await getSecret('session-secret', 'SESSION_SECRET');
        } catch (error) {
            sessionSecret = 'cnmcg135-villa-agency-emergency-session-secret-2025-07-22-' + Date.now();
            console.log('🔄 Using emergency session secret');
        }
        
        const sessionConfig = {
            secret: sessionSecret,
            resave: false,
            saveUninitialized: false,
            rolling: true,
            cookie: {
                secure: isProduction,
                httpOnly: true,
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000
            },
            name: 'villaAgencySession'
        };
        
        // Try SQL Server session store
        try {
            const connectionString = await getSecret('database-connection-string', 'DATABASE_CONNECTION_STRING');
            
            if (connectionString) {
                console.log('🔄 Attempting SQL Server session store...');
                const MsSqlStore = require('connect-mssql-v2');
                
                const sessionStore = new MsSqlStore({
                    connectionString: connectionString,
                    options: {
                        table: 'Sessions',
                        autoRemove: 'interval',
                        autoRemoveInterval: 60000
                    }
                }, (err) => {
                    if (err) {
                        console.error('❌ Session store error:', err.message);
                    } else {
                        console.log('✅ SQL Server session store ready');
                    }
                });

                sessionStore.on('error', (err) => {
                    console.error('❌ Session store runtime error:', err.message);
                });

                sessionConfig.store = sessionStore;
                console.log('✅ Using SQL Server session store');
            }
        } catch (storeError) {
            console.error('❌ Session store setup failed:', storeError.message);
            console.log('⚠️ Using memory store');
        }
        
        app.use(session(sessionConfig));
        console.log('✅ Session middleware initialized');
        
    } catch (error) {
        console.error('❌ Session initialization failed:', error.message);
        console.log('🔄 Using basic session fallback');
        
        // Ultimate fallback session
        app.use(session({
            secret: 'cnmcg135-villa-agency-ultimate-fallback-' + Date.now(),
            resave: false,
            saveUninitialized: false,
            cookie: {
                secure: false,
                httpOnly: true,
                maxAge: 24 * 60 * 60 * 1000
            }
        }));
        
        console.log('✅ Fallback session applied');
    }
}

// =================================================================
//                      DATABASE CONNECTION (WITH FALLBACK)
// =================================================================
let pool = null;

async function connectToDatabase() {
    try {
        console.log('🔄 Connecting to database...');
        
        const connectionString = await getSecret('database-connection-string', 'DATABASE_CONNECTION_STRING');
        
        if (!connectionString) {
            console.log('⚠️ No database connection string, running in limited mode');
            return;
        }
        
        console.log('🔗 Attempting database connection...');
        pool = await new sql.ConnectionPool(connectionString).connect();
        
        // Test connection
        await pool.request().query('SELECT 1 as test');
        console.log('✅ Database connected successfully');
        
        // Initialize tables
        await initializeUsersTable();
        
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        console.log('⚠️ Continuing without database (fallback mode)');
        pool = null;
    }
}

async function initializeUsersTable() {
    if (!pool) return;
    
    try {
        console.log('🔄 Initializing Users table...');
        
        const checkTableQuery = `
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'Users'
        `;
        
        const tableExists = await pool.request().query(checkTableQuery);
        
        if (tableExists.recordset[0].count === 0) {
            const createTableQuery = `
                CREATE TABLE Users (
                    UserID int IDENTITY(1,1) PRIMARY KEY,
                    Username nvarchar(50) UNIQUE NOT NULL,
                    PasswordHash nvarchar(255) NOT NULL,
                    Role nvarchar(20) DEFAULT 'user',
                    CreatedAt datetime DEFAULT GETDATE(),
                    IsActive bit DEFAULT 1
                )
            `;
            
            await pool.request().query(createTableQuery);
            console.log('✅ Users table created');
            
            // Create admin user
            const defaultPassword = await getSecret('default-admin-password', 'DEFAULT_ADMIN_PASSWORD') || 'admin123';
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            
            await pool.request()
                .input('username', sql.NVarChar(50), 'admin')
                .input('passwordHash', sql.NVarChar(255), hashedPassword)
                .input('role', sql.NVarChar(20), 'admin')
                .query('INSERT INTO Users (Username, PasswordHash, Role) VALUES (@username, @passwordHash, @role)');
                
            console.log('✅ Admin user created');
            console.log(`📋 Username: admin, Password: ${defaultPassword}`);
        }
    } catch (error) {
        console.error('❌ Users table initialization failed:', error.message);
    }
}

// =================================================================
//                      APPLICATION INITIALIZATION
// =================================================================
async function initializeApplication() {
    try {
        console.log('🚀 Initializing Villa Agency application...');
        
        // 1. Initialize Key Vault (non-blocking)
        await initializeKeyVault().catch(err => {
            console.log('⚠️ Key Vault init failed, continuing with env vars');
        });
        
        // 2. Initialize Session (critical)
        await initializeSession();
        
        // 3. Connect to Database (non-blocking)
        await connectToDatabase().catch(err => {
            console.log('⚠️ Database init failed, continuing in limited mode');
        });
        
        console.log('✅ Application initialization completed');
        
    } catch (error) {
        console.error('❌ Application initialization error:', error.message);
        console.log('⚠️ Continuing with minimal configuration...');
        
        // Emergency session setup
        app.use(session({
            secret: 'emergency-villa-agency-session-' + Date.now(),
            resave: false,
            saveUninitialized: false,
            cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
        }));
    }
}

// Initialize everything
initializeApplication();

// =================================================================
//                      MIDDLEWARE AND LOGGING
// =================================================================
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
});

// =================================================================
//                      HEALTH CHECK ENDPOINTS
// =================================================================
app.get('/health', (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        database: pool ? 'connected' : 'fallback-mode',
        keyVault: keyVaultClient ? 'connected' : 'env-vars',
        session: !!req.sessionID,
        version: '1.2.0',
        user: 'cnmcg135'
    };
    
    res.status(200).json(health);
});

app.get('/api/test', (req, res) => {
    res.json({
        message: 'API is working',
        timestamp: new Date().toISOString(),
        sessionId: req.sessionID || 'no-session'
    });
});

// =================================================================
//                      AUTHENTICATION APIS
// =================================================================
app.post('/api/login', async (req, res) => {
    const timestamp = new Date().toISOString();
    const { username, password } = req.body;
    
    console.log(`[${timestamp}] Login attempt: ${username}`);
    
    try {
        if (!username || !password) {
            return res.status(400).json({ 
                success: false,
                message: 'Vui lòng nhập đầy đủ thông tin' 
            });
        }
        
        let user = null;
        
        // Try database authentication first
        if (pool) {
            try {
                const result = await pool.request()
                    .input('username', sql.NVarChar(50), username)
                    .query('SELECT UserID, Username, PasswordHash, Role FROM Users WHERE Username = @username AND IsActive = 1');
                
                if (result.recordset.length > 0) {
                    const dbUser = result.recordset[0];
                    const isValid = await bcrypt.compare(password, dbUser.PasswordHash);
                    
                    if (isValid) {
                        user = {
                            id: dbUser.UserID,
                            username: dbUser.Username,
                            role: dbUser.Role
                        };
                        console.log(`[${timestamp}] Database auth successful`);
                    }
                }
            } catch (dbError) {
                console.error(`[${timestamp}] Database auth error:`, dbError.message);
            }
        }
        
        // Fallback authentication
        if (!user && username === 'admin' && password === 'admin123') {
            user = { id: 1, username: 'admin', role: 'admin' };
            console.log(`[${timestamp}] Fallback auth successful`);
        }
        
        if (!user) {
            console.log(`[${timestamp}] Auth failed`);
            return res.status(401).json({ 
                success: false,
                message: 'Sai tên đăng nhập hoặc mật khẩu' 
            });
        }
        
        // Create session
        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role,
            loginTime: new Date().toISOString()
        };
        
        console.log(`[${timestamp}] Session created for ${user.username}`);
        
        res.json({
            success: true,
            message: 'Đăng nhập thành công',
            redirectTo: '/admin/dashboard.html',
            user: { username: user.username, role: user.role }
        });
        
    } catch (error) {
        console.error(`[${timestamp}] Login error:`, error.message);
        res.status(500).json({ 
            success: false,
            message: 'Lỗi server' 
        });
    }
});

app.get('/api/auth/status', (req, res) => {
    if (req.session && req.session.user) {
        res.json({
            authenticated: true,
            user: req.session.user
        });
    } else {
        res.json({ authenticated: false });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Logout error:', err);
        }
        res.json({ success: true, redirectTo: '/admin/login.html' });
    });
});

// =================================================================
//                      ROUTING
// =================================================================

// Redirects
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        res.redirect('/admin/dashboard.html');
    } else {
        res.redirect('/admin/login.html');
    }
});

app.get('/login', (req, res) => res.redirect('/admin/login.html'));
app.get('/admin', (req, res) => res.redirect('/admin/login.html'));

// Static files
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/vendor', express.static(path.join(__dirname, 'vendor')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Admin login page
app.get('/admin/login.html', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/admin/dashboard.html');
    }
    
    const loginPath = path.join(__dirname, 'admin', 'login.html');
    if (fs.existsSync(loginPath)) {
        res.sendFile(loginPath);
    } else {
        res.status(404).send('Login page not found');
    }
});

// Admin dashboard (protected)
app.get('/admin/dashboard.html', requireAdmin, (req, res) => {
    const dashboardPath = path.join(__dirname, 'admin', 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
        res.sendFile(dashboardPath);
    } else {
        res.status(404).send('Dashboard not found');
    }
});

// Protected admin static files
app.use('/admin', requireAdmin, express.static(path.join(__dirname, 'admin')));

// Root static files
app.use(express.static(path.join(__dirname, '')));

// =================================================================
//                      ERROR HANDLERS
// =================================================================

// 404 handler
app.use((req, res) => {
    console.log(`404: ${req.method} ${req.path}`);
    res.status(404).json({ 
        message: 'Not Found',
        path: req.path
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server Error:', err.message);
    res.status(500).json({ 
        message: 'Internal Server Error',
        error: isProduction ? 'Something went wrong' : err.message
    });
});

// =================================================================
//                      GRACEFUL SHUTDOWN HANDLING
// =================================================================
const server = app.listen(port, () => {
    console.log('=================================================================');
    console.log(`🚀 Villa Agency Server running on port ${port}`);
    console.log(`📅 Started: ${new Date().toISOString()}`);
    console.log(`🌍 Environment: ${isProduction ? 'Production' : 'Development'}`);
    console.log(`💾 Database: ${pool ? 'Connected' : 'Fallback Mode'}`);
    console.log(`🔐 Key Vault: ${keyVaultClient ? 'Connected' : 'Environment Variables'}`);
    console.log(`📋 Login: admin / admin123`);
    console.log('=================================================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📋 SIGTERM received - graceful shutdown');
    server.close(() => {
        console.log('✅ HTTP server closed');
        if (pool) {
            pool.close().then(() => {
                console.log('✅ Database closed');
                process.exit(0);
            });
        } else {
            process.exit(0);
        }
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received - graceful shutdown');
    server.close(() => {
        console.log('✅ HTTP server closed');
        process.exit(0);
    });
});

// Keep process alive
setInterval(() => {
    // Heartbeat to prevent Azure from sleeping the app
}, 5 * 60 * 1000); // Every 5 minutes