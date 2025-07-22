// =================================================================
//                      KHAI BÁO THƯ VIỆN
// =================================================================
const express = require('express');
const sql = require('mssql');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcrypt');
const MsSqlStore = require('connect-mssql-v2');
require('dotenv').config();

// Import middleware từ file riêng
const { requireAdmin } = require('./middleware.js');

// =================================================================
//                      KHỞI TẠO VÀ CẤU HÌNH EXPRESS
// =================================================================
const app = express();
const port = process.env.PORT || 3000;

// Middleware để đọc dữ liệu JSON và form
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cấu hình Session cho Azure
const isProduction = process.env.NODE_ENV === 'production';

console.log('Environment:', isProduction ? 'Production' : 'Development');
console.log('Session Secret exists:', !!process.env.SESSION_SECRET);
console.log('Database Connection String exists:', !!process.env.DATABASE_CONNECTION_STRING);

// Khởi tạo session store với error handling tốt hơn
let sessionStore;
try {
    sessionStore = new MsSqlStore({
        connectionString: process.env.DATABASE_CONNECTION_STRING,
        options: {
            table: 'Sessions',
            autoRemove: 'interval',
            autoRemoveInterval: 60000 // 1 phút
        }
    }, (err) => {
        if (err) {
            console.error('LỖI KHI KHỞI TẠO SESSION STORE:', err);
        } else {
            console.log('Session Store khởi tạo thành công');
        }
    });

    sessionStore.on('error', (err) => {
        console.error('LỖI SESSION STORE:', err);
    });

    sessionStore.on('connect', () => {
        console.log('Session Store đã kết nối');
    });
} catch (error) {
    console.error('Lỗi tạo Session Store:', error);
    // Fallback to memory store in development
    if (!isProduction) {
        console.log('Sử dụng Memory Store làm fallback');
        sessionStore = null;
    }
}

// Cấu hình session được tối ưu cho Azure
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'minhcong13052004-fallback-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true, // Gia hạn session mỗi khi có activity
    cookie: {
        secure: isProduction, // true khi HTTPS trên Azure
        httpOnly: true,
        sameSite: isProduction ? 'lax' : 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 giờ
        domain: undefined // Để Azure tự xử lý
    },
    name: 'sessionId' // Tên rõ ràng cho session cookie
};

// Chỉ thêm store nếu khởi tạo thành công
if (sessionStore) {
    sessionConfig.store = sessionStore;
} else {
    console.warn('Sử dụng memory store - không phù hợp cho production!');
}

app.use(session(sessionConfig));

// Trust proxy cho Azure App Service
if (isProduction) {
    app.set('trust proxy', 1);
    console.log('Trust proxy enabled for Azure');
}

// Middleware logging cho session
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path} - Session ID: ${req.sessionID}`);
    if (req.session && req.session.user) {
        console.log(`[${timestamp}] User: ${req.session.user.username} (${req.session.user.role})`);
    }
    next();
});

// Cấu hình Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// =================================================================
//                      KẾT NỐI CƠ SỞ DỮ LIỆU
// =================================================================
const connectionString = process.env.DATABASE_CONNECTION_STRING;
let pool;

async function connectToDatabase() {
    if (!connectionString) {
        console.error("LỖI CẤU HÌNH: Biến môi trường DATABASE_CONNECTION_STRING chưa được thiết lập.");
        process.exit(1);
    }

    try {
        pool = await new sql.ConnectionPool(connectionString).connect();
        console.log("Kết nối CSDL thành công!");
        
        await initializeUsersTable();
    } catch (err) {
        console.error("LỖI KẾT NỐI CSDL:", err);
        process.exit(1);
    }
}

async function initializeUsersTable() {
    try {
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
            console.log("Đã tạo bảng Users thành công!");
            
            // Tạo tài khoản admin mặc định
            const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
            const hashedPassword = await bcrypt.hash(defaultPassword, 10);
            
            const createAdminQuery = `
                INSERT INTO Users (Username, PasswordHash, Role) 
                VALUES (@username, @passwordHash, @role)
            `;
            
            await pool.request()
                .input('username', sql.NVarChar(50), 'admin')
                .input('passwordHash', sql.NVarChar(255), hashedPassword)
                .input('role', sql.NVarChar(20), 'admin')
                .query(createAdminQuery);
                
            console.log("Đã tạo tài khoản admin mặc định!");
            console.log(`Username: admin`);
            console.log(`Password: ${defaultPassword}`);
        } else {
            console.log("Bảng Users đã tồn tại.");
        }
    } catch (err) {
        console.error("Lỗi khi khởi tạo bảng Users:", err);
    }
}

connectToDatabase();

// =================================================================
//                      API XÁC THỰC (ĐƯỢC SỬA LẠI HOÀN TOÀN)
// =================================================================

// API Login được cải thiện
app.post('/api/login', async (req, res) => {
    const timestamp = new Date().toISOString();
    const { username, password } = req.body;
    
    console.log(`[${timestamp}] [LOGIN] Bắt đầu xử lý đăng nhập cho user: ${username}`);
    console.log(`[${timestamp}] [LOGIN] Session ID: ${req.sessionID}`);
    console.log(`[${timestamp}] [LOGIN] Request IP: ${req.ip}`);
    console.log(`[${timestamp}] [LOGIN] User Agent: ${req.get('User-Agent')}`);
    
    if (!username || !password) {
        console.log(`[${timestamp}] [LOGIN] Thiếu thông tin đăng nhập`);
        return res.status(400).json({ 
            success: false,
            message: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu' 
        });
    }
    
    try {
        if (!pool) {
            console.log(`[${timestamp}] [LOGIN] Pool không khả dụng`);
            return res.status(500).json({ 
                success: false,
                message: 'Lỗi server: CSDL chưa sẵn sàng.' 
            });
        }
        
        console.log(`[${timestamp}] [LOGIN] Tìm kiếm user trong database...`);
        
        const userQuery = `
            SELECT UserID, Username, PasswordHash, Role, IsActive 
            FROM Users 
            WHERE Username = @username AND IsActive = 1
        `;
        
        const userResult = await pool.request()
            .input('username', sql.NVarChar(50), username)
            .query(userQuery);
        
        console.log(`[${timestamp}] [LOGIN] Kết quả tìm kiếm: ${userResult.recordset.length} user(s)`);
        
        if (userResult.recordset.length === 0) {
            console.log(`[${timestamp}] [LOGIN] Không tìm thấy user hoặc user bị vô hiệu hóa`);
            return res.status(401).json({ 
                success: false,
                message: 'Tên đăng nhập hoặc mật khẩu không đúng' 
            });
        }
        
        const user = userResult.recordset[0];
        console.log(`[${timestamp}] [LOGIN] Tìm thấy user: ${user.Username}, Role: ${user.Role}`);
        
        // Kiểm tra mật khẩu
        console.log(`[${timestamp}] [LOGIN] Kiểm tra mật khẩu...`);
        const isPasswordValid = await bcrypt.compare(password, user.PasswordHash);
        
        if (!isPasswordValid) {
            console.log(`[${timestamp}] [LOGIN] Mật khẩu không chính xác`);
            return res.status(401).json({ 
                success: false,
                message: 'Tên đăng nhập hoặc mật khẩu không đúng' 
            });
        }
        
        console.log(`[${timestamp}] [LOGIN] Mật khẩu chính xác. Tạo session...`);
        
        // Regenerate session ID để bảo mật
        req.session.regenerate((err) => {
            if (err) {
                console.error(`[${timestamp}] [LOGIN] Lỗi regenerate session:`, err);
                return res.status(500).json({ 
                    success: false,
                    message: 'Lỗi server khi tạo session' 
                });
            }
            
            // Lưu thông tin user vào session
            req.session.user = {
                id: user.UserID,
                username: user.Username,
                role: user.Role,
                loginTime: new Date().toISOString()
            };
            
            console.log(`[${timestamp}] [LOGIN] Session data đã được set:`, req.session.user);
            
            // Lưu session
            req.session.save((saveErr) => {
                if (saveErr) {
                    console.error(`[${timestamp}] [LOGIN] Lỗi lưu session:`, saveErr);
                    return res.status(500).json({ 
                        success: false,
                        message: 'Lỗi server khi lưu session' 
                    });
                }
                
                console.log(`[${timestamp}] [LOGIN] Session đã được lưu thành công. New Session ID: ${req.sessionID}`);
                
                // Trả về response thành công
                const response = {
                    success: true,
                    message: 'Đăng nhập thành công',
                    redirectTo: '/admin/dashboard.html',
                    user: {
                        username: user.Username,
                        role: user.Role
                    },
                    sessionId: req.sessionID
                };
                
                console.log(`[${timestamp}] [LOGIN] Gửi response thành công:`, response);
                res.status(200).json(response);
            });
        });
        
    } catch (err) {
        console.error(`[${timestamp}] [LOGIN] Exception:`, err);
        res.status(500).json({ 
            success: false,
            message: 'Lỗi server khi đăng nhập',
            error: isProduction ? 'Internal Server Error' : err.message
        });
    }
});

// API kiểm tra trạng thái đăng nhập
app.get('/api/auth/status', (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [AUTH_STATUS] Kiểm tra trạng thái đăng nhập`);
    console.log(`[${timestamp}] [AUTH_STATUS] Session ID: ${req.sessionID}`);
    console.log(`[${timestamp}] [AUTH_STATUS] Session exists: ${!!req.session}`);
    console.log(`[${timestamp}] [AUTH_STATUS] User in session: ${!!req.session?.user}`);
    
    if (req.session && req.session.user) {
        console.log(`[${timestamp}] [AUTH_STATUS] User authenticated: ${req.session.user.username}`);
        res.json({
            authenticated: true,
            user: {
                username: req.session.user.username,
                role: req.session.user.role,
                loginTime: req.session.user.loginTime
            },
            sessionId: req.sessionID
        });
    } else {
        console.log(`[${timestamp}] [AUTH_STATUS] User not authenticated`);
        res.json({ 
            authenticated: false,
            sessionId: req.sessionID
        });
    }
});

// API logout
app.post('/api/logout', (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [LOGOUT] Xử lý đăng xuất`);
    
    req.session.destroy(err => {
        if (err) {
            console.error(`[${timestamp}] [LOGOUT] Lỗi khi đăng xuất:`, err);
            return res.status(500).json({ 
                success: false,
                message: 'Không thể đăng xuất' 
            });
        }
        
        res.clearCookie('sessionId');
        console.log(`[${timestamp}] [LOGOUT] Đăng xuất thành công`);
        
        res.json({ 
            success: true,
            message: 'Đăng xuất thành công', 
            redirectTo: '/admin/login.html' 
        });
    });
});

// API test cho debugging
app.get('/api/debug/session', (req, res) => {
    if (!isProduction) { // Chỉ hoạt động trong development
        res.json({
            sessionID: req.sessionID,
            session: req.session,
            cookies: req.headers.cookie,
            timestamp: new Date().toISOString()
        });
    } else {
        res.status(404).json({ message: 'Not found' });
    }
});

// =================================================================
//                      CÁC API KHÁC (GIỮ NGUYÊN)
// =================================================================

// API công khai
app.get('/api/properties', async (req, res) => {
    try {
        if (!pool) return res.status(500).json({ message: 'Lỗi server: CSDL chưa sẵn sàng.' });
        const result = await pool.request().query('SELECT * FROM Properties');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server khi truy vấn dữ liệu.' });
    }
});

// API Contact
app.post('/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;

    if (!name || !email || !subject || !message) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin.' });
    }

    try {
        if (!pool || !pool.connected) {
            return res.status(503).json({ message: 'Dịch vụ tạm thời không khả dụng.' });
        }
        
        const query = 'INSERT INTO Contacts (Name, Email, Subject, Message) VALUES (@name, @email, @subject, @message)';

        await pool.request()
            .input('name', sql.NVarChar, name)
            .input('email', sql.NVarChar, email)
            .input('subject', sql.NVarChar, subject)
            .input('message', sql.NVarChar, message)
            .query(query);

        res.status(200).json({ message: 'Tin nhắn đã được gửi thành công.' });

    } catch (err) {
        console.error('Lỗi khi lưu contact vào CSDL:', err);
        res.status(500).json({ message: 'Lỗi server, không thể lưu tin nhắn.' });
    }
});

// =================================================================
//                      API QUẢN TRỊ (Yêu cầu quyền Admin)
// =================================================================

// API lấy MỘT sản phẩm
app.get('/api/properties/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.request().input('id', sql.Int, id).query('SELECT * FROM Properties WHERE PropertyID = @id');
        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.status(404).json({ message: `Không tìm thấy sản phẩm với ID ${id}` });
        }
    } catch (err) {
        res.status(500).json({ message: 'Lỗi server.' });
    }
});

// API Thêm sản phẩm mới
app.post('/api/properties', requireAdmin, upload.single('imageFile'), async (req, res) => {
    const { Category, Price, Name, Bedrooms, Bathrooms, Area, Floor, Parking } = req.body;
    if (!req.file) {
        return res.status(400).json({ message: 'Vui lòng chọn một hình ảnh.' });
    }
    const imageURL = `/uploads/${req.file.filename}`;
    
    try {
        const query = `INSERT INTO Properties (Category, Price, Name, Bedrooms, Bathrooms, Area, Floor, Parking, ImageURL) VALUES (@Category, @Price, @Name, @Bedrooms, @Bathrooms, @Area, @Floor, @Parking, @ImageURL)`;
        await pool.request()
            .input('Category', sql.NVarChar(50), Category)
            .input('Price', sql.Decimal(18, 2), Price)
            .input('Name', sql.NVarChar(255), Name)
            .input('Bedrooms', sql.Int, Bedrooms || 0)
            .input('Bathrooms', sql.Int, Bathrooms || 0)
            .input('Area', sql.Decimal(10, 2), Area || 0)
            .input('Floor', sql.Int, Floor || 0)
            .input('Parking', sql.Int, Parking || 0)
            .input('ImageURL', sql.NVarChar(sql.MAX), imageURL)
            .query(query);
        res.status(201).json({ message: 'Thêm sản phẩm thành công' });
    } catch (err) {
        console.error('Lỗi khi thêm sản phẩm:', err);
        res.status(500).json({ message: 'Lỗi server khi thêm sản phẩm' });
    }
});

// API Cập nhật sản phẩm
app.put('/api/properties/:id', requireAdmin, upload.single('imageFile'), async (req, res) => {
    const { id } = req.params;
    const { Category, Price, Name, Bedrooms, Bathrooms, Area, Floor, Parking, existingImageURL } = req.body;
    
    let imageURL = existingImageURL;
    if (req.file) {
        imageURL = `/uploads/${req.file.filename}`;
    }

    try {
        if (!pool) return res.status(500).json({ message: 'Lỗi server: CSDL chưa sẵn sàng.' });

        const query = `
            UPDATE Properties SET 
                Category = @Category, 
                Price = @Price, 
                Name = @Name, 
                Bedrooms = @Bedrooms, 
                Bathrooms = @Bathrooms, 
                Area = @Area, 
                Floor = @Floor, 
                Parking = @Parking, 
                ImageURL = @ImageURL 
            WHERE PropertyID = @id
        `;

        await pool.request()
            .input('id', sql.Int, id)
            .input('Category', sql.NVarChar(50), Category)
            .input('Price', sql.Decimal(18, 2), Price)
            .input('Name', sql.NVarChar(255), Name)
            .input('Bedrooms', sql.Int, Bedrooms || 0)
            .input('Bathrooms', sql.Int, Bathrooms || 0)
            .input('Area', sql.Decimal(10, 2), Area || 0)
            .input('Floor', sql.Int, Floor || 0)
            .input('Parking', sql.Int, Parking || 0)
            .input('ImageURL', sql.NVarChar(sql.MAX), imageURL)
            .query(query);

        res.status(200).json({ message: `Cập nhật sản phẩm ID ${id} thành công` });

    } catch (err) {
        console.error(`Lỗi khi cập nhật sản phẩm ID ${id}:`, err);
        res.status(500).json({ message: 'Lỗi server khi cập nhật sản phẩm' });
    }
});

// API Xóa sản phẩm
app.delete('/api/properties/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.request().input('id', sql.Int, id).query(`DELETE FROM Properties WHERE PropertyID = @id`);
        if (result.rowsAffected[0] > 0) {
            res.status(200).json({ message: `Xóa sản phẩm ID ${id} thành công` });
        } else {
            res.status(404).json({ message: `Không tìm thấy sản phẩm với ID ${id}` });
        }
    } catch (err) {
        console.error(`Lỗi khi xóa sản phẩm ID ${id}:`, err);
        res.status(500).json({ message: 'Lỗi server khi xóa sản phẩm' });
    }
});

// API thay đổi mật khẩu admin
app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới' });
    }
    
    if (newPassword.length < 6) {
        return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
    }
    
    try {
        const userId = req.session.user.id;
        
        const userQuery = 'SELECT PasswordHash FROM Users WHERE UserID = @userId';
        const userResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(userQuery);
        
        if (userResult.recordset.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
        }
        
        const currentHashedPassword = userResult.recordset[0].PasswordHash;
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, currentHashedPassword);
        
        if (!isCurrentPasswordValid) {
            return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
        }
        
        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        
        const updateQuery = 'UPDATE Users SET PasswordHash = @newPasswordHash WHERE UserID = @userId';
        await pool.request()
            .input('userId', sql.Int, userId)
            .input('newPasswordHash', sql.NVarChar(255), newHashedPassword)
            .query(updateQuery);
        
        res.json({ message: 'Đổi mật khẩu thành công' });
        
    } catch (err) {
        console.error('Lỗi khi đổi mật khẩu:', err);
        res.status(500).json({ message: 'Lỗi server khi đổi mật khẩu' });
    }
});

// =================================================================
//                      PHỤC VỤ FILE TĨNH VÀ ROUTING
// =================================================================

// Route cho Let's Encrypt
const acmeChallengeFile = 'PCLHtQcSuK9lVz9RUQyO1l8IlON14ceXyEvVwgxXBkU';
const acmeChallengeContent = 'PCLHtQcSuK9lVz9RUQyO1l8IlON14ceXyEvVwgxXBkU.oPx2MRDy2BlWhrx4dCFxJXuU_iSxlMBt3kfFpijH3TU';

app.get(`/.well-known/acme-challenge/${acmeChallengeFile}`, (req, res) => {
    res.type('text/plain');
    res.send(acmeChallengeContent);
});

// Phục vụ file tĩnh công khai
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/vendor', express.static(path.join(__dirname, 'vendor')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// XỬ LÝ ĐẶC BIỆT CHO LOGIN PAGE
app.get('/admin/login.html', (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [ROUTE] GET /admin/login.html`);
    
    // Nếu đã đăng nhập, chuyển hướng về dashboard
    if (req.session && req.session.user) {
        console.log(`[${timestamp}] [ROUTE] User đã đăng nhập, chuyển hướng về dashboard`);
        return res.redirect('/admin/dashboard.html');
    }
    
    // Nếu chưa đăng nhập, hiển thị trang login
    console.log(`[${timestamp}] [ROUTE] Hiển thị trang login`);
    res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

// XỬ LÝ CHO DASHBOARD VÀ CÁC TRANG ADMIN KHÁC
app.get('/admin/dashboard.html', requireAdmin, (req, res) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [ROUTE] GET /admin/dashboard.html - User: ${req.session.user.username}`);
    res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

// Phục vụ các file tĩnh trong thư mục admin (có bảo vệ)
app.use('/admin', requireAdmin, express.static(path.join(__dirname, 'admin')));

// Phục vụ file tĩnh ở thư mục gốc
app.use(express.static(path.join(__dirname, '')));

// =================================================================
//                      ERROR HANDLING
// =================================================================

// 404 handler
app.use((req, res) => {
    console.log(`404 - Not Found: ${req.method} ${req.path}`);
    res.status(404).json({ message: 'Not Found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled Error:', err);
    res.status(500).json({ 
        message: 'Internal Server Error',
        error: isProduction ? 'Something went wrong' : err.message
    });
});

// =================================================================
//                      KHỞI ĐỘNG SERVER
// =================================================================
app.listen(port, () => {
    console.log(`=================================================================`);
    console.log(`Server đang chạy tại http://localhost:${port}`);
    console.log(`Environment: ${isProduction ? 'Production' : 'Development'}`);
    console.log(`Trust Proxy: ${isProduction ? 'Enabled' : 'Disabled'}`);
    console.log(`Session Store: ${sessionStore ? 'SQL Server' : 'Memory (Not recommended for production)'}`);
    console.log(`=================================================================`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    if (pool) {
        pool.close();
    }
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    if (pool) {
        pool.close();
    }
    process.exit(0);
});