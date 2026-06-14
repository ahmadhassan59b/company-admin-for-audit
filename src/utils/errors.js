class AppError extends Error {
  constructor(message, statusCode = 500, code = 'internal_error') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'not_found',
      message: 'Route not found'
    }
  });
}

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const isAppError = err instanceof AppError;

  if (statusCode >= 500) {
    req.logger.error(err.message, {
      stack: err.stack,
      path: req.path
    });
  }

  res.status(statusCode).json({
    error: {
      code: err.code || 'internal_error',
      message: isAppError ? err.message : statusCode >= 500 ? 'Internal server error' : err.message,
      ...(err.details ? { details: err.details } : {})
    }
  });
}

module.exports = {
  AppError,
  asyncHandler,
  notFoundHandler,
  errorHandler
};
