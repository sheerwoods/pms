// 业务错误 + 异步包装
class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res, next) => {
  try {
    Promise.resolve(fn(req, res, next)).catch(next);
  } catch (e) {
    next(e);
  }
};

module.exports = { AppError, wrap };
