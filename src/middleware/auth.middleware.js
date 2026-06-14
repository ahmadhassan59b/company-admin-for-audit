const authService = require('../services/auth/auth.service');
const tokenService = require('../services/auth/token.service');
const { AppError } = require('../utils/errors');

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}

async function optionalAuth(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      next();
      return;
    }

    const claims = tokenService.verifyToken(token);
    if (!claims) {
      throw new AppError('Invalid auth token', 401, 'invalid_auth_token');
    }

    const user = await authService.getUserById(claims.sub);
    if (!user) {
      throw new AppError('User not found', 401, 'invalid_auth_token');
    }

    req.user = authService.publicUser(user);
    req.tenantId = user.tenant_id;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAuth(req, res, next) {
  await optionalAuth(req, res, (error) => {
    if (error) {
      next(error);
      return;
    }

    if (!req.user) {
      next(new AppError('Authentication required', 401, 'authentication_required'));
      return;
    }

    next();
  });
}

module.exports = {
  optionalAuth,
  requireAuth
};
