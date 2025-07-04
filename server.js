const express = require('express');
const sql = require('mssql');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname)); 

const dbConfig = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
        encrypt: true,
        trustServerCertificate: false
    }
};

app.post('/contact', async (req, res) => {
    const { name, email, subject, message } = req.body;
    try {
        await sql.connect(dbConfig);
        const request = new sql.Request();
        const query = `INSERT INTO Contacts (Name, Email, Subject, Message) VALUES (@name, @email, @subject, @message)`;
        request.input('name', sql.NVarChar, name);
        request.input('email', sql.NVarChar, email);
        request.input('subject', sql.NVarChar, subject);
        request.input('message', sql.NVarChar, message);
        await request.query(query);
        res.send('<h1>Cảm ơn bạn! Tin nhắn đã được gửi.</h1><a href="/">Về trang chủ</a>');
    } catch (err) {
        console.error('LỖI DATABASE:', err);
        res.status(500).send('<h1>Đã có lỗi xảy ra phía server, vui lòng thử lại sau.</h1>');
    } finally {
        sql.close();
    }
});

app.listen(port, () => {
    console.log(`Server đang chạy tại http://localhost:${port}`);
});