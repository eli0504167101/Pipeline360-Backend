const { validCsrf } = require('../services/sessionService');
function requireOrigin(config) {
    return (req, res, next) => {
        if (req.get('Origin') !== config.origin || req.get('Sec-Fetch-Site') === 'cross-site') {
            return res.status(403).json({ error: 'Invalid request origin' });
        }
        next();
    };
}
function requireCsrf(req, res, next) {
    if (!validCsrf(req.auth.token, req.get('X-CSRF-Token'))) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next();
}
module.exports = { requireOrigin, requireCsrf };
