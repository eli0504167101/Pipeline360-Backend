const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAuthConfig } = require('../src/config/auth');
const { hashPassword, verifyPassword } = require('../src/services/passwordService');
const { validToken, csrfToken, validCsrf } = require('../src/services/sessionService');
const local = { AUTH_ENV: 'local', AUTH_ORIGIN: 'http://hotel.local:3000' };

test('local HTTP configuration is explicit and uses a separate cookie name', () => {
    const config = loadAuthConfig(local);
    assert.equal(config.secure, false);
    assert.equal(config.cookieName, 'p360_local_session');
    assert.deepEqual(config.trustedProxies, []);
});
for (const environment of ['demo', 'production']) {
    test(`${environment} requires HTTPS and uses a host-only Secure cookie`, () => {
        assert.throws(() => loadAuthConfig({ ...local, AUTH_ENV: environment }));
        const config = loadAuthConfig({ AUTH_ENV: environment, AUTH_ORIGIN: 'https://hotel.example' });
        assert.equal(config.secure, true);
        assert.equal(config.cookieName, '__Host-p360_session');
    });
}
for (const env of [
    {}, { ...local, AUTH_ENV: 'unknown' }, { ...local, AUTH_ORIGIN: 'not-a-url' },
    { ...local, AUTH_ORIGIN: 'http://hotel.local/' },
    { ...local, AUTH_ORIGIN: 'http://user:password@hotel.local' },
    { ...local, AUTH_ORIGIN: 'http://public.example' },
    { ...local, AUTH_ORIGIN: 'ftp://hotel.local' },
    { ...local, NODE_ENV: 'production' },
    { ...local, AUTH_TRUSTED_PROXIES: 'true' },
    { ...local, AUTH_TRUSTED_PROXIES: '0.0.0.0/0' },
    { ...local, AUTH_TRUSTED_PROXIES: '127.0.0.1/33' }
]) {
    test(`invalid authentication configuration fails closed: ${JSON.stringify(env)}`, () => {
        assert.throws(() => loadAuthConfig(env));
    });
}

test('explicit proxy addresses and CIDRs are accepted', () => {
    assert.deepEqual(loadAuthConfig({ ...local, AUTH_TRUSTED_PROXIES: '127.0.0.1,10.1.0.0/24,::1' }).trustedProxies,
        ['127.0.0.1', '10.1.0.0/24', '::1']);
});

test('scrypt hashes are salted, verifiable, and reject wrong passwords', async () => {
    const password = 'A long testing password!';
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    assert.notEqual(first, second);
    assert.equal(first.includes(password), false);
    assert.equal(await verifyPassword(password, first), true);
    assert.equal(await verifyPassword('A wrong testing password!', first), false);
    assert.equal(await verifyPassword(password, undefined), false);
    assert.equal(await verifyPassword(password, 'invalid hash'), false);
});

test('password hashing bounds concurrent per-process memory', async () => {
    const first = hashPassword('A long testing password!');
    await assert.rejects(hashPassword('Another testing password!'), { status: 503 });
    await first;
});

test('CSRF proof is separate from the session identifier and rejects malformed tokens', () => {
    const token = 'a'.repeat(64);
    assert.equal(validToken(token), true);
    assert.equal(validToken({}), false);
    assert.notEqual(csrfToken(token), token);
    assert.equal(validCsrf(token, csrfToken(token)), true);
    for (const value of [undefined, '', 'b'.repeat(64), {}, 'a'.repeat(63)]) {
        assert.equal(validCsrf(token, value), false);
    }
});

test('server rejects insecure production configuration before opening a listener', () => {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync(process.execPath, ['src/server.js'], {
        cwd: require('node:path').join(__dirname, '..'),
        env: { PATH: process.env.PATH, AUTH_ENV: 'production', AUTH_ORIGIN: 'http://hotel.local' },
        encoding: 'utf8', timeout: 5000
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Demo and production authentication require HTTPS/);
    assert.equal(result.stdout.includes('Server running'), false);
});

test('IP budgets normalize mapped IPv4 and IPv6 textual variants and privacy addresses', () => {
    const { clientNetwork } = require('../src/middleware/authRateLimit');
    assert.equal(clientNetwork('::ffff:192.0.2.1'), clientNetwork('192.0.2.1'));
    assert.equal(clientNetwork('2001:db8::1'), clientNetwork('2001:0db8:0000:0000:0:0:0:2'));
    assert.notEqual(clientNetwork('2001:db8:0:1::1'), clientNetwork('2001:db8:0:2::1'));
    assert.throws(() => clientNetwork('invalid'));
});
