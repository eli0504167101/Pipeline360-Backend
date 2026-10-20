const { isIP } = require('node:net');

function loadAuthConfig(env = process.env) {
    const environment = env.AUTH_ENV;
    if (!['local', 'demo', 'production'].includes(environment)) {
        throw new Error('AUTH_ENV must be local, demo, or production');
    }
    let origin;
    try { origin = new URL(env.AUTH_ORIGIN); } catch {
        throw new Error('AUTH_ORIGIN must be an explicit HTTP(S) origin');
    }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== env.AUTH_ORIGIN ||
        origin.username || origin.password) {
        throw new Error('AUTH_ORIGIN must contain only scheme, host, and optional port');
    }
    if (environment !== 'local' && origin.protocol !== 'https:') {
        throw new Error('Demo and production authentication require HTTPS');
    }
    if (environment === 'local' && !['localhost', '127.0.0.1', '[::1]', 'hotel.local'].includes(origin.hostname)) {
        throw new Error('Local authentication is restricted to development hosts');
    }
    if (env.NODE_ENV === 'production' && environment === 'local') {
        throw new Error('Local authentication cannot run with NODE_ENV=production');
    }
    // Trust only explicitly configured proxy addresses, never arbitrary forwarded headers.
    const trustedProxies = env.AUTH_TRUSTED_PROXIES ? env.AUTH_TRUSTED_PROXIES.split(',') : [];
    for (const proxy of trustedProxies) {
        const [address, prefix, extra] = proxy.split('/');
        const family = isIP(address);
        if (!family || extra !== undefined || (prefix !== undefined &&
            (!/^\d+$/.test(prefix) || Number(prefix) <= 0 || Number(prefix) > (family === 4 ? 32 : 128)))) {
            throw new Error('AUTH_TRUSTED_PROXIES must contain explicit IP addresses or nonzero CIDRs');
        }
    }
    return Object.freeze({
        environment, origin: origin.origin, secure: origin.protocol === 'https:',
        cookieName: origin.protocol === 'https:' ? '__Host-p360_session' : 'p360_local_session',
        trustedProxies, sessionMs: 8 * 60 * 60 * 1000,
        rateWindowMs: 15 * 60 * 1000, ipLimit: 60, accountLimit: 10
    });
}
module.exports = { loadAuthConfig };
