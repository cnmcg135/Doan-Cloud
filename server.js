const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 8080;

// Simple middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

console.log('🚀 Villa Agency - Super Simple Auth');

// =================================================================
//                      SIMPLE AUTH STORAGE
// =================================================================
let loggedInUsers = new Set(); // Just store logged in IPs

function isLoggedIn(req) {
    const userKey = req.ip + '-' + req.get('User-Agent');
    return loggedInUsers.has(userKey);
}

function loginUser(req) {
    const userKey = req.ip + '-' + req.get('User-Agent');
    loggedInUsers.add(userKey);
    console.log(`✅ User logged in: ${req.ip}`);
}

function logoutUser(req) {
    const userKey = req.ip + '-' + req.get('User-Agent');
    loggedInUsers.delete(userKey);
    console.log(`❌ User logged out: ${req.ip}`);
}

// =================================================================
//                      SIMPLE PROTECTION MIDDLEWARE
// =================================================================
function requireLogin(req, res, next) {
    if (isLoggedIn(req)) {
        next();
    } else {
        console.log(`🔒 Access denied for ${req.ip} to ${req.path}`);
        if (req.path.startsWith('/api/')) {
            res.status(401).json({ message: 'Please login first' });
        } else {
            res.redirect('/admin/login.html');
        }
    }
}

// =================================================================
//                      ROUTES
// =================================================================

// Homepage - public
app.get('/', (req, res) => {
    console.log(`📄 Serving homepage to ${req.ip}`);
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('<h1>Villa Agency</h1><p><a href="/admin/login.html">Admin Login</a></p>');
    }
});

// Login page - public
app.get('/admin/login.html', (req, res) => {
    // If already logged in, redirect to dashboard
    if (isLoggedIn(req)) {
        console.log(`🔄 Already logged in, redirecting to dashboard`);
        return res.redirect('/admin/dashboard.html');
    }
    
    console.log(`🔐 Serving login page to ${req.ip}`);
    const loginPath = path.join(__dirname, 'admin', 'login.html');
    if (fs.existsSync(loginPath)) {
        res.sendFile(loginPath);
    } else {
        res.send(`
            <h1>Admin Login</h1>
            <form action="/api/login" method="post">
                <input type="text" name="username" placeholder="Username" required><br><br>
                <input type="password" name="password" placeholder="Password" required><br><br>
                <button type="submit">Login</button>
            </form>
            <p>Default: admin / admin123</p>
        `);
    }
});

// Dashboard - protected
app.get('/admin/dashboard.html', requireLogin, (req, res) => {
    console.log(`📊 Serving dashboard to logged in user ${req.ip}`);
    const dashboardPath = path.join(__dirname, 'admin', 'dashboard.html');
    if (fs.existsSync(dashboardPath)) {
        res.sendFile(dashboardPath);
    } else {
        res.send(`
            <h1>Admin Dashboard</h1>
            <h2>Welcome! You are logged in.</h2>
            <p><a href="/api/logout">Logout</a></p>
            <p>Dashboard file not found at: admin/dashboard.html</p>
        `);
    }
});

// Super simple login API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    console.log(`🔐 Login attempt from ${req.ip}: ${username}`);
    
    // SUPER SIMPLE CHECK - just hardcoded admin
    if (username === 'admin' && password === 'admin123') {
        loginUser(req);
        
        console.log(`✅ Login successful for ${req.ip}`);
        
        // Check if it's form submission (redirect) or API call (JSON)
        if (req.get('Content-Type')?.includes('application/x-www-form-urlencoded')) {
            // Form submission - redirect
            res.redirect('/admin/dashboard.html');
        } else {
            // API call - JSON response
            res.json({
                success: true,
                message: 'Login successful',
                redirectTo: '/admin/dashboard.html'
            });
        }
    } else {
        console.log(`❌ Login failed for ${req.ip}`);
        
        if (req.get('Content-Type')?.includes('application/x-www-form-urlencoded')) {
            res.send(`
                <h1>Login Failed</h1>
                <p>Wrong username or password</p>
                <p><a href="/admin/login.html">Try again</a></p>
                <p>Use: admin / admin123</p>
            `);
        } else {
            res.status(401).json({
                success: false,
                message: 'Wrong username or password'
            });
        }
    }
});

// Logout API
app.post('/api/logout', (req, res) => {
    logoutUser(req);
    res.json({
        success: true,
        message: 'Logged out',
        redirectTo: '/admin/login.html'
    });
});

app.get('/api/logout', (req, res) => {
    logoutUser(req);
    res.redirect('/admin/login.html');
});

// Auth status check
app.get('/api/auth/status', (req, res) => {
    res.json({
        authenticated: isLoggedIn(req),
        user: isLoggedIn(req) ? { username: 'admin' } : null
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        authenticated: isLoggedIn(req),
        activeUsers: loggedInUsers.size,
        version: 'super-simple',
        message: 'Simple auth working!'
    });
});

// Redirects
app.get('/admin', requireLogin, (req, res) => {
    res.redirect('/admin/dashboard.html');
});

app.get('/login', (req, res) => {
    res.redirect('/admin/login.html');
});

// =================================================================
//                      STATIC FILES
// =================================================================

// Public static files
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/vendor', express.static(path.join(__dirname, 'vendor')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Protected admin files
app.use('/admin', requireLogin, express.static(path.join(__dirname, 'admin')));

// Root static files (public)
app.use(express.static(path.join(__dirname, ''), { index: false }));

// =================================================================
//                      ERROR HANDLING
// =================================================================
app.use((req, res) => {
    res.status(404).send(`
        <h1>Page Not Found</h1>
        <p>Path: ${req.path}</p>
        <p><a href="/">Home</a> | <a href="/admin/login.html">Admin</a></p>
    `);
});

// =================================================================
//                      START SERVER
// =================================================================
const server = app.listen(port, () => {
    console.log('=================================================================');
    console.log(`🚀 Villa Agency Server (SUPER SIMPLE) running on port ${port}`);
    console.log(`📅 Started: ${new Date().toISOString()}`);
    console.log(`🔐 Authentication: IP + User-Agent based (ultra simple!)`);
    console.log(`📋 Login: admin / admin123`);
    console.log(`🌐 Test: http://localhost:${port}/admin/login.html`);
    console.log('=================================================================');
});

// Clean up every hour to prevent memory leak
setInterval(() => {
    console.log(`🧹 Cleaning up logged in users. Count: ${loggedInUsers.size}`);
    if (loggedInUsers.size > 100) {
        loggedInUsers.clear();
        console.log(`🧹 Cleared all logged in users`);
    }
}, 60 * 60 * 1000); // 1 hour

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📋 SIGTERM received');
    server.close(() => process.exit(0));
});