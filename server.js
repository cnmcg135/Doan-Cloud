// =================================================================
//                      KHAI BÁO THƯ VIỆN
// =================================================================
const express = require('express');
const sql = require('mssql');
const path = require('path');
const session = require('express-session');
const multer = require('multer'); // Thư viện xử lý file upload
require('dotenv').config();

// Import middleware từ file riêng
const { requireAdmin } = require('./middleware.js');


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

app.use(session({
    secret: 'minhcong13052004', // Giữ nguyên secret của bạn
    resave: false,
    saveUninitialized: true,
    cookie: {
        // secure: true CHỈ khi ở môi trường production (trên Azure với HTTPS)
        // secure: false khi ở môi trường local (với HTTP)
        secure: isProduction,

        // Các thiết lập bảo mật khác được khuyến nghị:
        httpOnly: true, // Ngăn JavaScript phía client truy cập vào cookie
        sameSite: 'lax', // Giúp chống lại tấn công CSRF
        maxAge: 60 * 60 * 1000 // 1 giờ
    }
}));

// Quan trọng: Báo cho Express tin tưởng proxy của Azure
// Điều này cần thiết để cookie 'secure' hoạt động đúng
if (isProduction) {
    app.set('trust proxy', 1); // Tin tưởng proxy đầu tiên
}

// Cấu hình Multer để lưu file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/'); // File sẽ được lưu vào thư mục này
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname); // Đặt lại tên file để tránh trùng lặp
    }
});
const upload = multer({ storage: storage });


// =================================================================
//                      KẾT NỐI CƠ SỞ DỮ LIỆU
// =================================================================
// Lấy chuỗi kết nối từ biến môi trường mà App Service đã tiêm vào từ Key Vault
const connectionString = process.env.DATABASE_CONNECTION_STRING;

let pool;
async function connectToDatabase() {
    // Kiểm tra xem biến môi trường có tồn tại không
    if (!connectionString) {
        console.error("LỖI CẤU HÌNH: Biến môi trường DATABASE_CONNECTION_STRING chưa được thiết lập trên App Service.");
        process.exit(1); // Thoát ứng dụng nếu không có chuỗi kết nối
    }

    try {
        // Sử dụng trực tiếp chuỗi kết nối này để tạo pool
        pool = await new sql.ConnectionPool(connectionString).connect();
        console.log("Kết nối CSDL bằng chuỗi kết nối từ Key Vault thành công!");
    } catch (err) {
        console.error("LỖI KẾT NỐI CSDL:", err);
        process.exit(1);
    }
}
connectToDatabase();


// =================================================================
//                      ĐỊNH NGHĨA CÁC API (PHẢI ĐẶT TRƯỚC PHỤC VỤ FILE TĨNH)
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

// =================================================================
// API /contact ĐÃ ĐƯỢC SỬA ĐỂ DÙNG POOL
// =================================================================
app.post('/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;

    console.log('Nhận được yêu cầu gửi liên hệ:', req.body);

    if (!name || !email || !subject || !message) {
        return res.status(400).json({ message: 'Vui lòng điền đầy đủ thông tin.' });
    }

    try {
        // Kiểm tra xem pool kết nối chung có sẵn sàng không
        if (!pool || !pool.connected) {
            console.error('API /contact: CSDL chưa sẵn sàng.');
            return res.status(503).json({ message: 'Dịch vụ tạm thời không khả dụng.' });
        }
        
        const query = 'INSERT INTO Contacts (Name, Email, Subject, Message) VALUES (@name, @email, @subject, @message)';

        // Sử dụng pool kết nối chung, không cần tạo connection mới
        await pool.request()
            .input('name', sql.NVarChar, name)
            .input('email', sql.NVarChar, email)
            .input('subject', sql.NVarChar, subject)
            .input('message', sql.NVarChar, message)
            .query(query);

        // Trả về kết quả thành công
        res.status(200).json({ message: 'Tin nhắn đã được gửi thành công.' });

    } catch (err) {
        // Xử lý lỗi nếu có
        console.error('Lỗi khi lưu contact vào CSDL:', err);
        res.status(500).json({ message: 'Lỗi server, không thể lưu tin nhắn.' });
    }
});

// --- API XÁC THỰC ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin123') {
        req.session.user = { username: 'admin', role: 'admin' };
        res.status(200).json({ message: 'Đăng nhập thành công', redirectTo: '/admin/dashboard.html' });
    } else {
        res.status(401).json({ message: 'Sai thông tin đăng nhập' });
    }
});

app.get('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send('Không thể đăng xuất');
        res.clearCookie('connect.sid');
        res.redirect('/admin/login.html');
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

// API Thêm sản phẩm mới (có xử lý upload file)
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

// API Cập nhật sản phẩm (có xử lý upload file)
// API Cập nhật sản phẩm (có xử lý upload file)
app.put('/api/properties/:id', requireAdmin, upload.single('imageFile'), async (req, res) => {
    const { id } = req.params;
    const { Category, Price, Name, Bedrooms, Bathrooms, Area, Floor, Parking, existingImageURL } = req.body;
    
    let imageURL = existingImageURL; // Mặc định giữ ảnh cũ
    if (req.file) {
        imageURL = `/uploads/${req.file.filename}`; // Nếu có ảnh mới, cập nhật đường dẫn
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

        // === PHẦN SỬA LỖI QUAN TRỌNG ===
        // Phải định nghĩa input cho TẤT CẢ các biến trong câu query
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
        // In ra lỗi chi tiết trong terminal để dễ debug
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

// ====================================================================
//                ROUTE ĐẶC BIỆT CHO LET'S ENCRYPT
// ====================================================================
// Mỗi lần retry, bạn cần vào đây và cập nhật lại TÊN FILE và NỘI DUNG
const acmeChallengeFile = 'PCLHtQcSuK9lVz9RUQyO1l8IlON14ceXyEvVwgxXBkU';
const acmeChallengeContent = 'PCLHtQcSuK9lVz9RUQyO1l8IlON14ceXyEvVwgxXBkU.oPx2MRDy2BlWhrx4dCFxJXuU_iSxlMBt3kfFpijH3TU';

app.get(`/.well-known/acme-challenge/${acmeChallengeFile}`, (req, res) => {
    res.type('text/plain');
    res.send(acmeChallengeContent);
});
// ====================================================================

// =================================================================
//                      PHỤC VỤ FILE TĨNH VÀ HTML (ĐẶT Ở CUỐI CÙNG)
// =================================================================
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use('/vendor', express.static(path.join(__dirname, 'vendor')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads'))); // Phục vụ thư mục ảnh upload

// Route cho trang đăng nhập (công khai)
app.get('/admin/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin/login.html'));
});

// Bảo vệ tất cả các file trong thư mục /admin
app.use('/admin', requireAdmin, express.static(path.join(__dirname, 'admin')));

// Phục vụ các file ở thư mục gốc (index.html, contact.html,...)
app.use(express.static(path.join(__dirname, '')));


// =================================================================
//                      KHỞI ĐỘNG SERVER
// =================================================================
app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});


