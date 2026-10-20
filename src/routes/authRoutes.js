const express = require('express');
const cookieParser = require('cookie-parser');
const { authController } = require('../controllers/authController');
const { requireAuth, publicUser } = require('../middleware/auth');
const { requireOrigin, requireCsrf } = require('../middleware/csrf');
const { authRateLimit } = require('../middleware/authRateLimit');
const { csrfToken } = require('../services/sessionService');

function authRoutes(config) {
    const router = express.Router();
    const controller = authController(config);
    const authenticate = requireAuth(config);
    const origin = requireOrigin(config);
    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        if (req.app.locals.authReady === false) {
            return res.status(503).json({ error: 'Authentication temporarily unavailable' });
        }
        next();
    });
    router.use(cookieParser());
    // Require same-origin JSON even for login/register to prevent login CSRF.
    router.use((req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        origin(req, res, () => {
            if (!req.is('application/json')) return res.status(415).json({ error: 'JSON content type required' });
            next();
        });
    });
    router.use(express.json({ limit: '8kb' }));
    router.post('/register', authRateLimit(config), controller.register);
    router.post('/login', authRateLimit(config), controller.login);
    router.get('/me', authenticate, (req, res) => res.json({ user: publicUser(req.auth.user) }));
    router.get('/csrf', authenticate, (req, res) => res.json({ csrfToken: csrfToken(req.auth.token) }));
    router.post('/logout', authenticate, requireCsrf, controller.logout);
    router.use((req, res) => res.status(404).json({ error: 'Authentication endpoint not found' }));
    router.use((error, req, res, next) => {
        if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
        if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
        return res.status(503).json({ error: 'Authentication temporarily unavailable' });
    });
    return router;
}
module.exports = authRoutes;
