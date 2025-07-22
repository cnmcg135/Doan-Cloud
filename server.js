const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const MSSQLStore = require('connect-mssql-v2')(session);
const { DefaultAzureCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');

const app = express();
const port = process.env.PORT || 8080;

// Azure and environment detection
const isAzure = process.env.WEBSITE_SITE_NAME || process.env.APPSETTING_WEBSITE_SITE_NAME;
const isDevelopment = !isAzure;

console.log(`🌐 Environment: ${isAzure ? 'Azure App Service' : 'Local Development'}`);

// Trust proxy for Azure App Service
if (isAzure) {
    app.set('trust proxy', 1);
}

// Session configuration
let sessionConfig = {
    secret: process.env.SESSION_SECRET || 'villa-agency-super-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isAzure, // Use secure cookies on Azure (HTTPS)
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
};

// Configure session store for Azure
if (isAzure && process.env.DATABASE_CONNECTION_STRING) {
    console.log('🔧 Configuring Azure SQL session store...');
    try {
        sessionConfig.store = new MSSQLStore({
            connectionString: process.env.DATABASE_CONNECTION_STRING,
            table: 'Sessions',
            autoRemove: 'interval',
            autoRemoveInterval: 1000 * 60 * 30, // 30 minutes
            autoRemoveCallback: function() {
                console.log('🧹 Expired sessions cleaned up');
            },
            createTable: true // Auto-create table if it doesn't exist
        });
        console.log('✅ Azure SQL session store configured');
    } catch (error) {
        console.warn('⚠️ Failed to configure SQL session store, falling back to memory store:', error.message);
    }
} else if (isAzure) {
    console.warn('⚠️ DATABASE_CONNECTION_STRING not found, using memory store (not recommended for production)');
}

app.use(session(sessionConfig));

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS headers for admin API calls
app.use('/api/', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'property-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

console.log('🚀 Villa Agency - Session-Based Authentication');

// =================================================================
//                      SESSION-BASED AUTHENTICATION
// =================================================================

function isLoggedIn(req) {
    return req.session && req.session.user && req.session.user.role === 'admin';
}

function loginUser(req, userData = { username: 'admin', role: 'admin' }) {
    req.session.user = userData;
    console.log(`✅ User logged in: ${userData.username} (Session: ${req.sessionID})`);
}

function logoutUser(req) {
    if (req.session.user) {
        console.log(`❌ User logged out: ${req.session.user.username} (Session: ${req.sessionID})`);
    }
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
    });
}

// =================================================================
//                      IN-MEMORY PROPERTY STORAGE
// =================================================================
let properties = [];
let nextPropertyId = 1;

// Sample data for testing
properties.push(
    {
        PropertyID: nextPropertyId++,
        Category: "Luxury Villa",
        Name: "Modern Villa in District 2",
        Price: 5000000000,
        Bedrooms: 4,
        Bathrooms: 3,
        Area: 300,
        Floor: 2,
        Parking: 2,
        ImageURL: "/assets/images/property-01.jpg"
    },
    {
        PropertyID: nextPropertyId++,
        Category: "Apartment",
        Name: "High-end Apartment Downtown",
        Price: 2500000000,
        Bedrooms: 2,
        Bathrooms: 2,
        Area: 120,
        Floor: 15,
        Parking: 1,
        ImageURL: "/assets/images/property-02.jpg"
    }
);

function isLoggedIn(req) {
    return req.session && req.session.user && req.session.user.role === 'admin';
}

function loginUser(req, userData = { username: 'admin', role: 'admin' }) {
    req.session.user = userData;
    console.log(`✅ User logged in: ${userData.username} (Session: ${req.sessionID})`);
}

function logoutUser(req) {
    if (req.session.user) {
        console.log(`❌ User logged out: ${req.session.user.username} (Session: ${req.sessionID})`);
    }
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
        }
    });
}

// =================================================================
//                      AUTHENTICATION MIDDLEWARE
// =================================================================
function requireLogin(req, res, next) {
    if (isLoggedIn(req)) {
        next();
    } else {
        console.log(`🔒 Access denied for ${req.ip} to ${req.path} (Session: ${req.sessionID || 'none'})`);
        if (req.path.startsWith('/api/')) {
            res.status(401).json({ 
                message: 'Please login first',
                redirectTo: '/admin/login.html'
            });
        } else {
            res.redirect('/admin/login.html');
        }
    }
}

// =================================================================
//                      STATIC FILES (PUBLIC)
// =================================================================

// Public static files BEFORE authentication
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/vendor', express.static(path.join(__dirname, 'vendor')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Public admin login assets (CSS, JS, images for login page)
app.use('/admin/css', express.static(path.join(__dirname, 'admin/css')));
app.use('/admin/js', express.static(path.join(__dirname, 'admin/js')));
app.use('/admin/assets', express.static(path.join(__dirname, 'admin/assets')));
app.use('/admin/img', express.static(path.join(__dirname, 'admin/img')));
app.use('/admin/fonts', express.static(path.join(__dirname, 'admin/fonts')));

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
        loginUser(req, { username: 'admin', role: 'admin' });
        
        console.log(`✅ Login successful for ${req.ip} (Session: ${req.sessionID})`);
        
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
        console.log(`❌ Login failed for ${req.ip} (Session: ${req.sessionID || 'none'})`);
        
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
        user: isLoggedIn(req) ? { username: req.session.user.username, role: req.session.user.role } : null,
        sessionId: req.sessionID
    });
});

// =================================================================
//                      PROPERTY MANAGEMENT API
// =================================================================

// Get all properties
app.get('/api/properties', requireLogin, (req, res) => {
    console.log(`📋 Getting all properties for ${req.ip}`);
    res.json(properties);
});

// Get single property by ID
app.get('/api/properties/:id', requireLogin, (req, res) => {
    const id = parseInt(req.params.id);
    const property = properties.find(p => p.PropertyID === id);
    
    if (property) {
        console.log(`📋 Getting property ${id} for ${req.ip}`);
        res.json(property);
    } else {
        console.log(`❌ Property ${id} not found for ${req.ip}`);
        res.status(404).json({ message: 'Property not found' });
    }
});

// Create new property
app.post('/api/properties', requireLogin, upload.single('imageFile'), (req, res) => {
    try {
        console.log(`➕ Creating new property for ${req.ip}`, req.body);
        
        const {
            Category = '',
            Name = '',
            Price = 0,
            Bedrooms = 0,
            Bathrooms = 0,
            Area = 0,
            Floor = 0,
            Parking = 0
        } = req.body;

        // Validation
        if (!Name || !Category || !Price) {
            return res.status(400).json({ 
                message: 'Name, Category, and Price are required' 
            });
        }

        // Handle image upload
        let imageURL = '/assets/images/property-default.jpg'; // Default image
        if (req.file) {
            imageURL = `/uploads/${req.file.filename}`;
            console.log(`📷 Image uploaded: ${imageURL}`);
        }

        const newProperty = {
            PropertyID: nextPropertyId++,
            Category: Category.trim(),
            Name: Name.trim(),
            Price: parseFloat(Price) || 0,
            Bedrooms: parseInt(Bedrooms) || 0,
            Bathrooms: parseInt(Bathrooms) || 0,
            Area: parseFloat(Area) || 0,
            Floor: parseInt(Floor) || 0,
            Parking: parseInt(Parking) || 0,
            ImageURL: imageURL
        };

        properties.push(newProperty);
        
        console.log(`✅ Property created with ID: ${newProperty.PropertyID}`);
        res.status(201).json({
            success: true,
            message: 'Property created successfully',
            property: newProperty
        });
        
    } catch (error) {
        console.error('Error creating property:', error);
        res.status(500).json({ 
            message: 'Error creating property: ' + error.message 
        });
    }
});

// Update property
app.put('/api/properties/:id', requireLogin, upload.single('imageFile'), (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const propertyIndex = properties.findIndex(p => p.PropertyID === id);
        
        if (propertyIndex === -1) {
            return res.status(404).json({ message: 'Property not found' });
        }

        console.log(`✏️ Updating property ${id} for ${req.ip}`, req.body);
        
        const {
            Category,
            Name,
            Price,
            Bedrooms,
            Bathrooms,
            Area,
            Floor,
            Parking,
            existingImageURL
        } = req.body;

        // Get current property
        const currentProperty = properties[propertyIndex];
        
        // Handle image update
        let imageURL = existingImageURL || currentProperty.ImageURL;
        if (req.file) {
            imageURL = `/uploads/${req.file.filename}`;
            console.log(`📷 New image uploaded: ${imageURL}`);
        }

        // Update property with provided values or keep existing ones
        const updatedProperty = {
            ...currentProperty,
            Category: Category ? Category.trim() : currentProperty.Category,
            Name: Name ? Name.trim() : currentProperty.Name,
            Price: Price ? parseFloat(Price) : currentProperty.Price,
            Bedrooms: Bedrooms !== undefined ? parseInt(Bedrooms) : currentProperty.Bedrooms,
            Bathrooms: Bathrooms !== undefined ? parseInt(Bathrooms) : currentProperty.Bathrooms,
            Area: Area !== undefined ? parseFloat(Area) : currentProperty.Area,
            Floor: Floor !== undefined ? parseInt(Floor) : currentProperty.Floor,
            Parking: Parking !== undefined ? parseInt(Parking) : currentProperty.Parking,
            ImageURL: imageURL
        };

        properties[propertyIndex] = updatedProperty;
        
        console.log(`✅ Property ${id} updated successfully`);
        res.json({
            success: true,
            message: 'Property updated successfully',
            property: updatedProperty
        });
        
    } catch (error) {
        console.error('Error updating property:', error);
        res.status(500).json({ 
            message: 'Error updating property: ' + error.message 
        });
    }
});

// Delete property
app.delete('/api/properties/:id', requireLogin, (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const propertyIndex = properties.findIndex(p => p.PropertyID === id);
        
        if (propertyIndex === -1) {
            return res.status(404).json({ message: 'Property not found' });
        }

        console.log(`🗑️ Deleting property ${id} for ${req.ip}`);
        
        const deletedProperty = properties.splice(propertyIndex, 1)[0];
        
        console.log(`✅ Property ${id} deleted successfully`);
        res.json({
            success: true,
            message: 'Property deleted successfully',
            property: deletedProperty
        });
        
    } catch (error) {
        console.error('Error deleting property:', error);
        res.status(500).json({ 
            message: 'Error deleting property: ' + error.message 
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        authenticated: isLoggedIn(req),
        environment: isAzure ? 'Azure App Service' : 'Local Development',
        sessionId: req.sessionID,
        version: 'session-based-auth',
        message: 'Session-based auth working!'
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
//                      PROTECTED STATIC FILES
// =================================================================

// Protected admin files (require authentication)
app.use('/admin', requireLogin, express.static(path.join(__dirname, 'admin')));

// Root static files (public) - excluding admin directory
app.use(express.static(path.join(__dirname, ''), { 
    index: false,
    ignore: ['admin/**']
}));

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

const server = app.listen(port, () => {
    console.log('=================================================================');
    console.log(`🚀 Villa Agency Server (SESSION-BASED AUTH) running on port ${port}`);
    console.log(`📅 Started: ${new Date().toISOString()}`);
    console.log(`🌐 Environment: ${isAzure ? 'Azure App Service' : 'Local Development'}`);
    console.log(`🔐 Authentication: Express session-based`);
    console.log(`📋 Login: admin / admin123`);
    console.log(`🌐 Test: http://localhost:${port}/admin/login.html`);
    if (isAzure) {
        console.log(`🔧 Trust proxy: enabled for Azure App Service`);
        console.log(`🍪 Secure cookies: enabled for HTTPS`);
        console.log(`💾 Session store: ${sessionConfig.store ? 'Azure SQL' : 'Memory (fallback)'}`);
    }
    console.log('=================================================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📋 SIGTERM received');
    server.close(() => process.exit(0));
});