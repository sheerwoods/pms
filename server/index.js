// Express 入口
const path = require('path');
const fs = require('fs');
const express = require('express');
const { AppError } = require('./errors');

require('./db');
const nightAudit = require('./nightAudit');

const app = express();
app.use(express.json());

// 请求日志
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.originalUrl}`);
  }
  next();
});

// 登录相关接口：公开，必须挂在鉴权网关之前
app.use('/api/auth', require('./routes/auth'));

// 鉴权网关：验证会话并绑定门店上下文，之后所有 /api 请求都已登录
app.use('/api', require('./middleware/storeContext').storeContext);

// 业务路由
app.use('/api', require('./routes/rooms'));
app.use('/api', require('./routes/reservations'));
app.use('/api', require('./routes/finance'));
app.use('/api', require('./routes/ar'));
app.use('/api', require('./routes/stats'));
app.use('/api', require('./routes/night_audit'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/card'));

// API 404
app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));

// 生产环境托管前端构建产物
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// 错误处理
app.use((err, req, res, next) => {
  const status = err instanceof AppError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message || '服务器错误' });
});

// 启动夜审定时检查
nightAudit.startScheduler();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ PMS 服务已启动: http://localhost:${PORT}`));
