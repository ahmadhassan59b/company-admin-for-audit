const authService = require('../services/auth/auth.service');

function setPrivateCache(res, maxAgeSeconds = 30) {
  res.setHeader('Cache-Control', `private, max-age=${maxAgeSeconds}, stale-while-revalidate=120`);
  res.setHeader('Vary', 'Authorization');
}

async function register(req, res) {
  const result = await authService.register(req.body);

  res.status(201).json({
    data: result
  });
}

async function login(req, res) {
  const result = await authService.login(req.body);

  res.json({
    data: result
  });
}

async function googleConfig(req, res) {
  setPrivateCache(res, 300);
  res.json({
    data: {
      clientId: authService.getGoogleClientId()
    }
  });
}

async function googleSignIn(req, res) {
  const result = await authService.googleSignIn(req.body);

  res.json({
    data: result
  });
}

async function resendVerification(req, res) {
  const result = await authService.resendVerification(req.body);

  res.json({
    data: result
  });
}

async function verifyEmail(req, res) {
  const token = req.query.token || req.body.token;
  const result = await authService.verifyEmail(token);

  res.json({
    data: result
  });
}

async function me(req, res) {
  setPrivateCache(res, 30);
  res.json({
    data: {
      user: req.user
    }
  });
}

module.exports = {
  register,
  login,
  googleConfig,
  googleSignIn,
  resendVerification,
  verifyEmail,
  me
};
