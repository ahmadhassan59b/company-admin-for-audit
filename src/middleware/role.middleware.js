const { AppError } = require('../utils/errors');

function requireRole(allowedRole) {
  return (req, res, next) => {
    const userRole = String(req.user && req.user.role ? req.user.role : '').toLowerCase();
    const safeAllowed = String(allowedRole || '').toLowerCase();

    if (!userRole) {
      next(new AppError('Authentication required', 401, 'authentication_required'));
      return;
    }

    if (safeAllowed && userRole !== safeAllowed) {
      next(new AppError('Forbidden', 403, 'forbidden'));
      return;
    }

    next();
  };
}

module.exports = {
  requireRole
};
