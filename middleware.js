// middleware.js

function requireAdmin(req, res, next) {
    console.log(`[Middleware] Kiểm tra URL: ${req.path}`);

    // SỬA 1: Chấp nhận cả '/login' và '/login.html'
    if (req.path === '/login' || req.path === '/login.html') {
        console.log('[Middleware] URL là trang đăng nhập. Bỏ qua xác thực.');
        return next();
    }
    
    // Kiểm tra xem có session và user không
    if (!req.session || !req.session.user) {
        console.log('[Middleware] Không tìm thấy session. Chuyển hướng về trang đăng nhập.');
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            // SỬA 2: Thêm 'return' để kết thúc hàm
            return res.status(401).json({ 
                message: 'Unauthorized', 
                redirectTo: '/admin/login.html' 
            });
        }
        // SỬA 2: Thêm 'return' để kết thúc hàm
        return res.redirect('/admin/login.html');
    }
    
    // Kiểm tra role admin
    if (req.session.user.role !== 'admin') {
        console.log(`[Middleware] User ${req.session.user.username} không có quyền admin. Từ chối truy cập.`);
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            // SỬA 2: Thêm 'return' để kết thúc hàm
            return res.status(403).json({ 
                message: 'Access denied. Admin role required.' 
            });
        }
        // SỬA 2: Thêm 'return' để kết thúc hàm
        return res.status(403).send('Access denied. Admin role required.');
    }
    
    console.log('[Middleware] Xác thực thành công. Cho phép truy cập.');
    next();
}

module.exports = {
    requireAdmin
};