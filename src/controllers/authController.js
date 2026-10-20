const User = require('../models/User');
const Session = require('../models/Session');
const { hashPassword, verifyPassword } = require('../services/passwordService');
const { createSession, cookieOptions, validToken, digest } = require('../services/sessionService');
const { publicUser } = require('../middleware/auth');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function credentials(body, registration) {
    const fields = registration ? ['fullName', 'email', 'password'] : ['email', 'password'];
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) return null;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body.password;
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    if (!EMAIL.test(email) || email.length > 254 || typeof password !== 'string' ||
        password.length < 12 || password.length > 128 || Buffer.byteLength(password) > 256 ||
        (registration && (!fullName || fullName.length > 120))) return null;
    return { email, password, fullName };
}
function authController(config) {
    async function authenticate(req, res, user, status) {
        // Replace any existing session instead of accepting a client-selected identifier.
        const previous = req.cookies[config.cookieName];
        if (validToken(previous)) await Session.deleteOne({ tokenHash: digest(previous) });
        const token = await createSession(user._id, config);
        res.cookie(config.cookieName, token, { ...cookieOptions(config), maxAge: config.sessionMs });
        return res.status(status).json({ user: publicUser(user) });
    }
    return {
        async register(req, res, next) {
            try {
                const input = credentials(req.body, true);
                if (!input) return res.status(400).json({ error: 'Invalid registration fields' });
                const passwordHash = await hashPassword(input.password);
                const user = await User.create({ fullName: input.fullName, email: input.email, passwordHash, subscriptionTier: 'free' });
                return await authenticate(req, res, user, 201);
            } catch (error) {
                if (error.code === 11000) return res.status(409).json({ error: 'Email is already registered' });
                next(error);
            }
        },
        async login(req, res, next) {
            try {
                const input = credentials(req.body, false);
                if (!input) return res.status(400).json({ error: 'Invalid login fields' });
                const user = await User.findOne({ email: input.email }).select('+passwordHash').lean();
                if (!await verifyPassword(input.password, user?.passwordHash)) {
                    return res.status(401).json({ error: 'Invalid email or password' });
                }
                return await authenticate(req, res, user, 200);
            } catch (error) { next(error); }
        },
        async logout(req, res, next) {
            try {
                await Session.deleteOne({ _id: req.auth.session._id });
                res.clearCookie(config.cookieName, cookieOptions(config));
                return res.status(204).end();
            } catch (error) { next(error); }
        }
    };
}
module.exports = { authController };
