const AuthRateLimit = require('../models/AuthRateLimit');
const { digest } = require('../services/sessionService');
async function increment(id, expiresAt) {
    const update = { $inc: { count: 1 }, $setOnInsert: { expiresAt } };
    try {
        return await AuthRateLimit.findOneAndUpdate({ _id: id }, update, { upsert: true, returnDocument: 'after' });
    } catch (error) {
        // Concurrent first attempts may race to insert the same unique bucket.
        if (error.code !== 11000) throw error;
        return AuthRateLimit.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { returnDocument: 'after' });
    }
}
function authRateLimit(config) {
    return async (req, res, next) => {
        try {
            const bucket = Math.floor(Date.now() / config.rateWindowMs);
            const expiresAt = new Date((bucket + 1) * config.rateWindowMs);
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
            // Shared across login/register and all replicas; no raw email/IP in limiter records.
            for (const [scope, value, limit] of [['ip', req.ip, config.ipLimit], ['account', email, config.accountLimit]]) {
                const record = await increment(digest(`${scope}:${value}:${bucket}`), expiresAt);
                if (!record || record.count > limit) {
                    res.set('Retry-After', String(Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000))));
                    return res.status(429).json({ error: 'Too many authentication attempts' });
                }
            }
            next();
        } catch (error) { next(error); }
    };
}
module.exports = { authRateLimit };
