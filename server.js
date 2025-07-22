// =================================================================
//                      KHAI BÁO THƯ VIỆN
// =================================================================
const express = require('express');
const sql = require('mssql');
const path = require('path');
const session = require('express-session');
const multer = require('multer'); // Thư viện xử lý file upload
const bcrypt = require('bcrypt'); // Thêm bcrypt để mã hóa mật khẩu
const MsSqlStore = require('connect-mssql-v2');
require('dotenv').config();

// Import middleware từ file riêng
const { requireAdmin } = require('./middleware.js');
const { table } = require('console');


// =================================================================
//                      KHỞI TẠO VÀ CẤU HÌNH EXPRESS
// =================================================================
const app = express();
const port = process.env.PORT || 3000;

// Middleware để đọc dữ liệu JSON và form
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình Session
const isProduction = process.env.NODE_ENV === 'production';
const sessionStore = new MsSqlStore({
    connectionString: process.env.DATABASE_CONNECTION_STRING,
        options: {
            table: 'Sessions'
        }
});
app.use(session({
    secret: process.env.SESSION_SECRET || 'minhcong13052004', // Nên lưu trong biến môi trường
    resave: false,
    saveUninitialized: false, // Thay đổi thành false để tránh tạo session không cần thiết
    cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 60 * 60 * 1000 // 1 giờ
    }
}));

// Quan trọng: Báo cho Express tin tưởng proxy của Azure
if (isProduction) {
    app.set('trust proxy', 1);
}

// Cấu hình Multer để lưu file upload
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
        
        // Tự động tạo bảng Users nếu chưa có
        await initializeUsersTable();
    } catch (err) {
        console.error("LỖI KẾT NỐI CSDL:", err);
        process.exit(1);
    }
}

// Hàm khởi tạo bảng Users và tạo admin mặc định
async function initializeUsersTable() {
    try {
        // Kiểm tra xem bảng Users đã tồn tại chưa
        const checkTableQuery = `
            SELECT COUNT(*) as count 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_NAME = 'Users'
        `;
        
        const tableExists = await pool.request().query(checkTableQuery);
        
        if (tableExists.recordset[0].count === 0) {
            // Tạo bảng Users
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
        } else {
            console.log("Bảng Users đã tồn tại.");
        }
    } catch (err) {
        console.error("Lỗi khi khởi tạo bảng Users:", err);
    }
}

connectToDatabase();


// =================================================================
//                      ĐỊNH NGHĨA CÁC API
// =================================================================

// --- API CÔNG KHAI ---
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

// --- API XÁC THỰC (SỬA CHÍNH) ---
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ message: 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu' });
    }
    
    try {
        if (!pool) {
            return res.status(500).json({ message: 'Lỗi server: CSDL chưa sẵn sàng.' });
        }
        
        // Tìm user trong database
        const userQuery = `
            SELECT UserID, Username, PasswordHash, Role, IsActive 
            FROM Users 
            WHERE Username = @username AND IsActive = 1
        `;
        
        const userResult = await pool.request()
            .input('username', sql.NVarChar(50), username)
            .query(userQuery);
        
        if (userResult.recordset.length === 0) {
            return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
        }
        
        const user = userResult.recordset[0];
        
        // Kiểm tra mật khẩu
        const isPasswordValid = await bcrypt.compare(password, user.PasswordHash);
        
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Tên đăng nhập hoặc mật khẩu không đúng' });
        }
        
        // Lưu thông tin user vào session
        req.session.user = {
            id: user.UserID,
            username: user.Username,
            role: user.Role
        };
        
        // Lưu session và trả về kết quả
        req.session.save((err) => {
            if (err) {
                console.error('Lỗi lưu session:', err);
                return res.status(500).json({ message: 'Lỗi server khi đăng nhập' });
            }
            
            res.status(200).json({ 
                message: 'Đăng nhập thành công', 
                redirectTo: '/admin/dashboard.html',
                user: {
                    username: user.Username,
                    role: user.Role
                }
            });
        });
        
    } catch (err) {
        console.error('Lỗi khi đăng nhập:', err);
        res.status(500).json({ message: 'Lỗi server khi đăng nhập' });
    }
});

// API kiểm tra trạng thái đăng nhập
app.get('/api/auth/status', (req, res) => {
    if (req.session && req.session.user) {
        res.json({
            authenticated: true,
            user: {
                username: req.session.user.username,
                role: req.session.user.role
            }
        });
    } else {
        res.json({ authenticated: false });
    }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            console.error('Lỗi khi đăng xuất:', err);
            return res.status(500).json({ message: 'Không thể đăng xuất' });
        }
        res.clearCookie('connect.sid');
        
        // Kiểm tra xem request có phải từ AJAX không
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            res.json({ message: 'Đăng xuất thành công', redirectTo: '/admin/login.html' });
        } else {
            res.redirect('/admin/login.html');
        }
    });
});

// --- API QUẢN TRỊ (CRUD - Yêu cầu quyền Admin) ---

// API lấy MỘT sản phẩm (cho trang Sửa)
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
        
        // Lấy mật khẩu hiện tại từ database
        const userQuery = 'SELECT PasswordHash FROM Users WHERE UserID = @userId';
        const userResult = await pool.request()
            .input('userId', sql.Int, userId)
            .query(userQuery);
        
        if (userResult.recordset.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
        }
        
        const currentHashedPassword = userResult.recordset[0].PasswordHash;
        
        // Kiểm tra mật khẩu hiện tại
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, currentHashedPassword);
        
        if (!isCurrentPasswordValid) {
            return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
        }
        
        // Mã hóa mật khẩu mới
        const newHashedPassword = await bcrypt.hash(newPassword, 10);
        
        // Cập nhật mật khẩu trong database
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

// ====================================================================
//                ROUTE ĐẶC BIỆT CHO LET'S ENCRYPT
// ====================================================================
const acmeChallengeFile = 'PCLHtQcSuK9lVz9RUQyO1l8IlON14ceXyEvVwgxXBkU';
const acmeChallengeContent = 'PCLHtQcSuK9lVz9RUQyO1l8IlON14ceXyEvVwgxXBkU.oPx2MRDy2BlWhrx4dCFxJXuU_iSxlMBt3kfFpijH3TU';

app.get(`/.well-known/acme-challenge/${acmeChallengeFile}`, (req, res) => {
    res.type('text/plain');
    res.send(acmeChallengeContent);
});

// =================================================================
//                      PHỤC VỤ FILE TĨNH VÀ HTML
// =================================================================
// Phục vụ các thư mục công khai, không cần xác thực
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/vendor', express.static(path.join(__dirname, 'vendor')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// 1. Xử lý đặc biệt cho trang login.html
//    Nếu đã đăng nhập, chuyển hướng đi. Nếu chưa, cho phép truy cập.
app.get('/admin/login.html', (req, res, next) => {
    console.log('[Route] Xử lý GET /admin/login.html');
    if (req.session && req.session.user) {
        console.log('[Route] User đã đăng nhập, chuyển hướng tới dashboard.');
        return res.redirect('/admin/dashboard.html');
    }
    // Nếu chưa đăng nhập, cho phép đi tiếp để express.static phục vụ file
    console.log('[Route] User chưa đăng nhập, cho phép hiển thị trang login.');
    next();
});

// 2. Áp dụng middleware bảo vệ cho TẤT CẢ các đường dẫn /admin
//    Middleware này sẽ chạy cho mọi thứ trong /admin (ví dụ: /admin/dashboard.html)
//    Nhưng nó sẽ bỏ qua /admin/login.html nhờ logic ta thêm vào ở Bước 1.
app.use('/admin', requireAdmin);

// 3. SAU KHI đã qua lớp bảo vệ, phục vụ các file tĩnh trong thư mục /admin
//    Chỉ những ai vượt qua `requireAdmin` mới đến được đây.
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Phục vụ các file ở thư mục gốc (như trang chủ của website)
app.use(express.static(path.join(__dirname, '')));

// =================================================================
//                      KHỞI ĐỘNG SERVER
// =================================================================
app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});