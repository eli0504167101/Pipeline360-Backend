const Session = require('../models/Session');
const User = require('../models/User');
const { validToken, digest } = require('../services/sessionService');

function requireAuth(config) {
    return async (req, res, next) => {
        try {
            const token = req.cookies[config.cookieName];
            if (!validToken(token)) return res.status(401).json({ error: 'Authentication required' });
            const session = await Session.findOne({ tokenHash: digest(token), expiresAt: { $gt: new Date() } }).lean();
            if (!session) return res.status(401).json({ error: 'Authentication required' });
            const user = await User.findById(session.userId).lean();
            if (!user) return res.status(401).json({ error: 'Authentication required' });
            req.auth = { user, session, token };
            next();
        } catch (error) { next(error); }
    };
}
function publicUser(user) {
    return { id: String(user._id), fullName: user.fullName, email: user.email, subscriptionTier: user.subscriptionTier };
}
module.exports = { requireAuth, publicUser };
