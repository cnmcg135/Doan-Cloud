// middleware.js
const path = require('path');

function requireAdmin(req, res, next) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [Middleware] Kiểm tra URL: ${req.path}`);
    console.log(`[${timestamp}] [Middleware] Method: ${req.method}`);
    console.log(`[${timestamp}] [Middleware] Session ID: ${req.sessionID}`);
    console.log(`[${timestamp}] [Middleware] Session exists: ${!!req.session}`);
    
    if (req.session && req.session.user) {
        console.log(`[${timestamp}] [Middleware] User in session:`, {
            id: req.session.user.id,
            username: req.session.user.username,
            role: req.session.user.role
        });
    } else {
        console.log(`[${timestamp}] [Middleware] No user in session`);
    }

    // Danh sách các đường dẫn KHÔNG cần xác thực
    const publicPaths = [
        '/admin/login.html',
        '/admin/login',
        '/login',
        '/login.html',
        '/api/login'
    ];

    // Danh sách các file tĩnh không cần xác thực
    const publicAssets = [
        '/admin/css/',
        '/admin/js/',
        '/admin/assets/',
        '/admin/img/',
        '/admin/fonts/',
        '/assets/',
        '/vendor/',
        '/uploads/'
    ];

    // Kiểm tra đường dẫn công khai
    const isPublicPath = publicPaths.includes(req.path);
    const isPublicAsset = publicAssets.some(asset => req.path.startsWith(asset));

    if (isPublicPath || isPublicAsset) {
        console.log(`[${timestamp}] [Middleware] Đường dẫn công khai. Bỏ qua xác thực.`);
        return next();
    }
    
    // Kiểm tra session và user
    if (!req.session) {
        console.log(`[${timestamp}] [Middleware] Không có session object`);
        return redirectToLogin(req, res, 'No session object');
    }

    if (!req.session.user) {
        console.log(`[${timestamp}] [Middleware] Không có user trong session`);
        return redirectToLogin(req, res, 'No user in session');
    }
    
    // Kiểm tra role admin
    if (req.session.user.role !== 'admin') {
        console.log(`[${timestamp}] [Middleware] User ${req.session.user.username} không có quyền admin. Role: ${req.session.user.role}`);
        
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.status(403).json({ 
                message: 'Access denied. Admin role required.',
                currentRole: req.session.user.role
            });
        }
        return res.status(403).send('Access denied. Admin role required.');
    }
    
    console.log(`[${timestamp}] [Middleware] Xác thực thành công cho user: ${req.session.user.username}`);
    next();
}

function redirectToLogin(req, res, reason) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [Middleware] Chuyển hướng về login. Lý do: ${reason}`);
    
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(401).json({ 
            message: 'Unauthorized', 
            redirectTo: '/admin/login.html',
            reason: reason
        });
    }
    return res.redirect('/admin/login.html');
}

module.exports = {
    requireAdmin
};