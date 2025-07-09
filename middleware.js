function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'admin') {
        // Nếu user trong session là admin, cho phép đi tiếp
        return next();
    } else {
        // Nếu không, trả về lỗi 401 cho API hoặc chuyển hướng cho trang web
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).send('Yêu cầu xác thực Admin');
        }
        return res.redirect('/admin/login.html');
    }
}

module.exports = { requireAdmin };