const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const Session = require('../models/Session');
const digest = value => createHash('sha256').update(value).digest('hex');
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const csrfToken = token => digest(`csrf:${token}`);
function validCsrf(token, supplied) {
    return validToken(supplied) && timingSafeEqual(Buffer.from(csrfToken(token), 'hex'), Buffer.from(supplied, 'hex'));
}
async function createSession(userId, config) {
    const token = randomBytes(32).toString('hex');
    await Session.create({ tokenHash: digest(token), userId, expiresAt: new Date(Date.now() + config.sessionMs) });
    return token;
}
function cookieOptions(config) {
    return { httpOnly: true, secure: config.secure, sameSite: 'lax', path: '/' };
}
module.exports = { digest, validToken, csrfToken, validCsrf, createSession, cookieOptions };
