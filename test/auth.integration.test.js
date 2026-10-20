const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { createApp } = require('../src/app');
const { loadAuthConfig } = require('../src/config/auth');
const { initializeAuthDatabase } = require('../src/services/authDatabase');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const AuthRateLimit = require('../src/models/AuthRateLimit');
const Hotel = require('../src/models/Hotel');
const Reservation = require('../src/models/Reservation');
const { digest } = require('../src/services/sessionService');
const { verifyPassword } = require('../src/services/passwordService');

const config = loadAuthConfig({ AUTH_ENV: 'local', AUTH_ORIGIN: 'http://hotel.local:3000' });
const input = { fullName: 'Test Guest', email: 'guest@example.com', password: 'A long testing password!' };
let database;
let apps;
function makeApp(options = config) {
    const app = createApp(options);
    app.set('env', 'test');
    return app;
}
function api(index = 0, method = 'get', path = '/api/auth/me') {
    return request(apps[index])[method](path).timeout({ response: 5000, deadline: 10000 });
}
function post(path, body, index = 0) {
    return api(index, 'post', `/api/auth/${path}`).set('Origin', config.origin).send(body);
}
function sessionCookie(response) {
    return response.headers['set-cookie'][0].split(';')[0];
}
async function register() {
    const response = await post('register', input).expect(201);
    return sessionCookie(response);
}
async function csrf(cookie, index = 0) {
    return (await api(index, 'get', '/api/auth/csrf').set('Cookie', cookie).expect(200)).body.csrfToken;
}

before(async () => {
    // The URI is generated here; never read MONGO_URL or accept an external database.
    database = await MongoMemoryServer.create({
        // Keep downloaded test binaries outside Jenkins' workspace/Docker build context.
        binary: { version: '7.0.24', downloadDir: require('node:path').join(require('node:os').tmpdir(), 'pipeline360-mongodb-binaries') },
        instance: { dbName: 'pipeline360_auth_test', ip: '127.0.0.1' }
    });
    await mongoose.connect(database.getUri());
    await initializeAuthDatabase();
    apps = Array.from({ length: 5 }, () => makeApp());
}, { timeout: 180000 });
after(async () => {
    await mongoose.disconnect();
    if (database) await database.stop();
});
beforeEach(async () => {
    // Delete only test collections in this suite's private temporary process.
    await Promise.all([User.deleteMany({}), Session.deleteMany({}), AuthRateLimit.deleteMany({}), Hotel.deleteMany({}), Reservation.deleteMany({})]);
});

test('registration persists a Free user, salted hash, and hashed session only', async () => {
    const response = await post('register', { ...input, email: ' GUEST@EXAMPLE.COM ', fullName: ' Test Guest ' }).expect(201);
    assert.deepEqual(Object.keys(response.body), ['user']);
    assert.deepEqual(response.body.user, {
        id: response.body.user.id, fullName: 'Test Guest', email: 'guest@example.com', subscriptionTier: 'free'
    });
    assert.equal(response.headers['cache-control'], 'no-store');
    const cookie = sessionCookie(response);
    const token = cookie.split('=')[1];
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.match(response.headers['set-cookie'][0], /HttpOnly/);
    assert.match(response.headers['set-cookie'][0], /SameSite=Lax/);
    assert.match(response.headers['set-cookie'][0], /Path=\//);
    assert.doesNotMatch(response.headers['set-cookie'][0], /Secure|Domain=/);
    const user = await User.findOne({}).select('+passwordHash').lean();
    assert.equal(await verifyPassword(input.password, user.passwordHash), true);
    assert.equal(user.subscriptionTier, 'free');
    assert.equal((await User.findOne({}).lean()).passwordHash, undefined);
    const session = await Session.findOne({}).select('+tokenHash').lean();
    assert.equal(session.tokenHash, digest(token));
    assert.notEqual(session.tokenHash, token);
    assert.equal(String(session.userId), String(user._id));
    assert.ok(session.expiresAt > new Date());
    const serialized = JSON.stringify(await Session.collection.findOne({}));
    assert.equal(serialized.includes(token), false);
    assert.equal(JSON.stringify(response.body).includes(token), false);
    assert.equal(JSON.stringify(response.body).includes(user.passwordHash), false);
});

test('unique email index rejects duplicate registration after normalization', async () => {
    await register();
    await post('register', { ...input, email: ' GUEST@EXAMPLE.COM ' }).expect(409);
    assert.equal(await User.countDocuments(), 1);
    assert.equal(await Session.countDocuments(), 1);
});

test('unique email constraint remains effective under concurrent database writes', async () => {
    const data = { fullName: input.fullName, email: input.email, passwordHash: 'test-only' };
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => User.create(data)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.ok(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 11000));
});

for (const extra of [{ subscriptionTier: 'premium' }, { userId: 'attacker' }, { passwordHash: 'attacker' }]) {
    test(`registration rejects client-controlled ${Object.keys(extra)[0]}`, async () => {
        await post('register', { ...input, ...extra }).expect(400);
        assert.equal(await User.countDocuments(), 0);
    });
}
for (const invalid of [
    { ...input, password: 'short' }, { ...input, password: 'x'.repeat(129) },
    { ...input, email: { $ne: null } }, { ...input, fullName: ' ' },
    { ...input, email: 'not-email' }, { ...input, fullName: 'x'.repeat(121) }
]) {
    test(`registration validates input: ${JSON.stringify(invalid).slice(0, 65)}`, async () => {
        await post('register', invalid).expect(400);
        assert.equal(await User.countDocuments(), 0);
        assert.equal(await Session.countDocuments(), 0);
    });
}

test('login verifies credentials, normalizes email, and replaces an existing session', async () => {
    const previous = await register();
    const response = await post('login', { email: ' GUEST@EXAMPLE.COM ', password: input.password })
        .set('Cookie', previous).expect(200);
    const next = sessionCookie(response);
    assert.notEqual(next, previous);
    await api().set('Cookie', previous).expect(401);
    await api().set('Cookie', next).expect(200);
    assert.equal(await Session.countDocuments(), 1);
    assert.deepEqual(Object.keys(response.body.user).sort(), ['email', 'fullName', 'id', 'subscriptionTier']);
});

test('incorrect passwords and unknown users receive the same generic login error', async () => {
    await register();
    for (const email of [input.email, 'unknown@example.com']) {
        await post('login', { email, password: 'A wrong testing password!' }).expect(401, { error: 'Invalid email or password' });
    }
    assert.equal(await Session.countDocuments(), 1);
});

test('login rejects membership changes and cannot modify the stored Free tier', async () => {
    await register();
    await post('login', { email: input.email, password: input.password, subscriptionTier: 'premium' }).expect(400);
    assert.equal((await User.findOne({}).lean()).subscriptionTier, 'free');
    await api(0, 'patch', '/api/auth/me').set('Origin', config.origin)
        .send({ subscriptionTier: 'premium' }).expect(404);
});

test('all five app instances accept the same persisted session and current database user state', async () => {
    const cookie = await register();
    const user = await User.findOne({});
    await User.updateOne({ _id: user._id }, { $set: { fullName: 'Updated Guest' } });
    for (let index = 0; index < 5; index++) {
        const response = await api(index).set('Cookie', cookie).expect(200);
        assert.equal(response.body.user.fullName, 'Updated Guest');
    }
    // Reconnect rather than rely on process-local session state.
    await mongoose.disconnect();
    await mongoose.connect(database.getUri());
    await api(4).set('Cookie', cookie).expect(200);
});

test('expired sessions are rejected immediately even before MongoDB TTL cleanup', async () => {
    const cookie = await register();
    await Session.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal(await Session.countDocuments(), 1);
    await api().set('Cookie', cookie).expect(401);
    await api(0, 'get', '/api/auth/csrf').set('Cookie', cookie).expect(401);
});

test('missing, malformed, tampered, and unknown session cookies are rejected', async () => {
    await api().expect(401);
    for (const token of ['invalid', 'a'.repeat(64), '%ZZ', 'a'.repeat(65)]) {
        await api().set('Cookie', `${config.cookieName}=${token}`).expect(401);
    }
    assert.equal(await Session.countDocuments(), 0);
});

test('sessions for deleted users are rejected', async () => {
    const cookie = await register();
    await User.deleteMany({});
    await api().set('Cookie', cookie).expect(401);
});

test('logout requires CSRF and invalidates the session across all replicas', async () => {
    const cookie = await register();
    const token = await csrf(cookie, 1);
    await post('logout', {}).set('Cookie', cookie).expect(403);
    await post('logout', {}).set('Cookie', cookie).set('X-CSRF-Token', 'a'.repeat(64)).expect(403);
    assert.equal(await Session.countDocuments(), 1);
    const response = await post('logout', {}, 4).set('Cookie', cookie).set('X-CSRF-Token', token).expect(204);
    assert.match(response.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/);
    assert.equal(await Session.countDocuments(), 0);
    for (let index = 0; index < 5; index++) await api(index).set('Cookie', cookie).expect(401);
});

test('CSRF proof from another session is rejected', async () => {
    const first = await register();
    const second = sessionCookie(await post('login', { email: input.email, password: input.password }).expect(200));
    await post('logout', {}).set('Cookie', second).set('X-CSRF-Token', await csrf(first)).expect(403);
});

test('login/register reject missing or foreign origins and form submissions', async () => {
    for (const path of ['register', 'login']) {
        await api(0, 'post', `/api/auth/${path}`).send(input).expect(403);
        await post(path, input).set('Origin', 'https://attacker.example').expect(403);
        await post(path, input).set('Sec-Fetch-Site', 'cross-site').expect(403);
        await api(0, 'post', `/api/auth/${path}`).set('Origin', config.origin).type('form').send(input).expect(415);
    }
    assert.equal(await User.countDocuments(), 0);
});

test('auth responses never enable cross-origin credential access', async () => {
    const response = await api().set('Origin', 'https://attacker.example').expect(401);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
});

test('invalid JSON and oversized authentication bodies have sanitized errors', async () => {
    await api(0, 'post', '/api/auth/login').set('Origin', config.origin).type('json').send('{broken')
        .expect(400, { error: 'Invalid JSON' });
    await post('register', { ...input, fullName: 'x'.repeat(9000) }).expect(413, { error: 'Request too large' });
});

test('HTTPS configuration emits Secure host-only session cookies', async () => {
    const secure = loadAuthConfig({ AUTH_ENV: 'production', AUTH_ORIGIN: 'https://hotel.example' });
    const response = await request(makeApp(secure)).post('/api/auth/register').set('Origin', secure.origin).send(input).expect(201);
    const cookie = response.headers['set-cookie'][0];
    assert.match(cookie, /^__Host-p360_session=/);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; SameSite=Lax/);
    assert.doesNotMatch(cookie, /Domain=/);
});

test('account rate limits are atomic and shared across five replicas and login/register', async () => {
    const responses = await Promise.all(Array.from({ length: 15 }, (_, index) =>
        post(index % 2 ? 'login' : 'register', { email: input.email, password: 'short' }, index % 5)));
    assert.equal(responses.filter(response => response.status === 400).length, 10);
    assert.equal(responses.filter(response => response.status === 429).length, 5);
    assert.ok(responses.filter(response => response.status === 429).every(response => Number(response.headers['retry-after']) > 0));
    const records = await AuthRateLimit.find().lean();
    assert.deepEqual(records.map(record => record.count), [15, 15]);
    assert.equal(JSON.stringify(records).includes(input.email), false);
});

test('IP rate limit rejects changing emails and ignores spoofed forwarded addresses by default', async () => {
    const limited = { ...config, ipLimit: 2 };
    const app = makeApp(limited);
    for (let index = 0; index < 3; index++) {
        await request(app).post('/api/auth/login').set('Origin', config.origin)
            .set('X-Forwarded-For', `192.0.2.${index + 1}`)
            .send({ email: `guest${index}@example.com`, password: 'short' }).expect(index < 2 ? 400 : 429);
    }
});

test('unique and TTL indexes exist in the actual MongoDB database', async () => {
    assert.ok((await User.collection.indexes()).some(index => index.key.email === 1 && index.unique));
    const indexes = await Session.collection.indexes();
    assert.ok(indexes.some(index => index.key.tokenHash === 1 && index.unique));
    assert.ok(indexes.some(index => index.key.expiresAt === 1 && index.expireAfterSeconds === 0));
    assert.ok((await AuthRateLimit.collection.indexes()).some(index => index.key.expiresAt === 1 && index.expireAfterSeconds === 0));
});

test('database unavailability fails authentication closed with no leaked details', async () => {
    const cookie = await register();
    await mongoose.disconnect();
    try {
        await api().set('Cookie', cookie).expect(503, { error: 'Authentication temporarily unavailable' });
        await post('login', { email: input.email, password: input.password }).expect(503, { error: 'Authentication temporarily unavailable' });
    } finally { await mongoose.connect(database.getUri()); }
});

test('readiness stays unavailable until authentication indexes initialize', async () => {
    const app = makeApp();
    app.locals.authReady = false;
    await request(app).get('/health').expect(200);
    await request(app).get('/ready').expect(503);
    app.locals.authReady = true;
    await request(app).get('/ready').expect(200);
});


test('auth-enabled application preserves public reservation creation, lookup, and cancellation', async () => {
    await Hotel.create({ hotelId: 'AUTH-REGRESSION-HOTEL', hotelName: 'Test Hotel', pricePerNight: 100 });
    const response = await api(0, 'post', '/api/reservations').send({
        fullName: input.fullName, email: input.email, hotelId: 'AUTH-REGRESSION-HOTEL',
        checkIn: '2030-06-01', checkOut: '2030-06-03'
    }).expect(201);
    const id = response.body.reservationId;
    await api(1, 'get', `/api/reservations/lookup/${id}`).expect(200);
    await api(2, 'delete', `/api/reservations/${id}`).expect(200);
    assert.equal(await Reservation.countDocuments(), 0);
});

test('authentication is blocked while startup index initialization is incomplete', async () => {
    const app = makeApp();
    app.locals.authReady = false;
    await request(app).post('/api/auth/register').set('Origin', config.origin).send(input)
        .expect(503, { error: 'Authentication temporarily unavailable' });
    assert.equal(await User.countDocuments(), 0);
});

test('foreign origin cannot logout even with a valid session and CSRF proof', async () => {
    const cookie = await register();
    await post('logout', {}).set('Cookie', cookie).set('X-CSRF-Token', await csrf(cookie))
        .set('Origin', 'https://attacker.example').expect(403);
    assert.equal(await Session.countDocuments(), 1);
});

test('authenticated logout rejects expired sessions rather than clearing only the cookie', async () => {
    const cookie = await register();
    const token = await csrf(cookie);
    await Session.updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await post('logout', {}).set('Cookie', cookie).set('X-CSRF-Token', token).expect(401);
});

async function eventually(predicate, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail('Database recovery did not reach the expected state');
}

test('failed unique index initialization recovers only after the underlying duplicate data is resolved', async () => {
    await User.collection.dropIndex('email_1');
    await User.collection.insertMany([
        { fullName: 'One', email: input.email, passwordHash: 'test-only' },
        { fullName: 'Two', email: input.email, passwordHash: 'test-only' }
    ]);
    const app = makeApp();
    const { startDatabaseLifecycle } = require('../src/services/databaseLifecycle');
    const lifecycle = startDatabaseLifecycle({ app, uri: database.getUri(), retryMs: 25, log: () => {} });
    try {
        await lifecycle.initial;
        await request(app).get('/health').expect(200);
        await request(app).get('/ready').expect(503, { status: 'not ready', database: 'connected' });
        await request(app).post('/api/auth/register').set('Origin', config.origin).send(input).expect(503);
        // Repair only this temporary test database, never production records.
        await User.deleteMany({});
        await eventually(() => app.locals.authReady);
        await request(app).get('/ready').expect(200);
        assert.ok((await User.collection.indexes()).some(index => index.key.email === 1 && index.unique));
        await request(app).post('/api/auth/register').set('Origin', config.origin).send(input).expect(201);
    } finally { lifecycle.stop(); }
});

test('real MongoDB process loss closes readiness and auth until reconnect/index revalidation', { timeout: 40000 }, async () => {
    const { startDatabaseLifecycle } = require('../src/services/databaseLifecycle');
    const app = makeApp();
    const lifecycle = startDatabaseLifecycle({ app, uri: database.getUri(), retryMs: 25, log: () => {} });
    const cookie = await register();
    try {
        await lifecycle.initial;
        await database.stop({ doCleanup: false });
        await eventually(() => mongoose.connection.readyState !== 1 && !app.locals.authReady);
        await request(app).get('/health').expect(200);
        await request(app).get('/ready').expect(503);
        await request(app).get('/api/auth/me').set('Cookie', cookie).expect(503);
        await database.start(true);
        await eventually(() => app.locals.authReady);
        await request(app).get('/ready').expect(200);
        await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    } finally {
        lifecycle.stop();
        if (database.state !== 'running') await database.start(true);
        await eventually(() => mongoose.connection.readyState === 1);
    }
});

test('authentication sends majority write concern on actual insert, delete, index and atomic counter commands', async () => {
    await mongoose.disconnect();
    // An unsafe URI preference must not change auth reads into stale secondary reads.
    await mongoose.connect(database.getUri(), { monitorCommands: true, readPreference: 'secondary', serverSelectionTimeoutMS: 1000 });
    const client = mongoose.connection.getClient();
    const observed = [];
    const listener = event => {
        const command = event.command;
        const collection = command.insert || command.delete || command.findAndModify || command.createIndexes || command.find;
        if (['users', 'sessions', 'authratelimits'].includes(collection)) {
            // Retain metadata only: never record credential or session data.
            observed.push({ name: event.commandName, collection, writeConcern: command.writeConcern,
                readPreference: command.$readPreference, maxTimeMS: command.maxTimeMS });
        }
    };
    client.on('commandStarted', listener);
    try {
        await initializeAuthDatabase();
        const previous = await register();
        const response = await post('login', { email: input.email, password: input.password }).set('Cookie', previous).expect(200);
        const cookie = sessionCookie(response);
        await api().set('Cookie', cookie).expect(200);
        await post('logout', {}).set('Cookie', cookie).set('X-CSRF-Token', await csrf(cookie)).expect(204);
        for (const [name, collection] of [['insert', 'users'], ['insert', 'sessions'], ['delete', 'sessions'], ['findAndModify', 'authratelimits'], ['createIndexes', 'users']]) {
            const commands = observed.filter(command => command.name === name && command.collection === collection);
            assert.ok(commands.length > 0, `Missing wire command: ${name} ${collection}`);
            for (const command of commands) assert.deepEqual(command.writeConcern, { w: 'majority', wtimeout: 5000 });
        }
        const reads = observed.filter(command => command.name === 'find');
        assert.ok(reads.length > 0);
        for (const command of reads) assert.ok(!command.readPreference || command.readPreference.mode === 'primary');
        for (const command of observed.filter(command => command.name === 'createIndexes')) assert.equal(command.maxTimeMS, 10000);
    } finally {
        client.off('commandStarted', listener);
        await mongoose.disconnect();
        await mongoose.connect(database.getUri());
    }
});

for (const trusted of [false, true]) {
    test(`proxy chain honors the first untrusted hop (socket trusted=${trusted})`, async () => {
        const proxyConfig = { ...config, trustedProxies: trusted ? ['127.0.0.1', '::1'] : [], ipLimit: 2 };
        const app = makeApp(proxyConfig);
        const clientIp = '192.0.2.44';
        for (let index = 0; index < 3; index++) {
            await request(app).post('/api/auth/login').set('Origin', config.origin)
                .set('X-Forwarded-For', `198.51.100.${index + 1}, ${clientIp}`)
                .send({ email: `proxy${index}@example.com`, password: 'short' })
                .expect(index < 2 ? 400 : 429);
        }
        if (trusted) {
            // A distinct real client behind the same trusted proxy has its own budget.
            await request(app).post('/api/auth/login').set('Origin', config.origin)
                .set('X-Forwarded-For', '192.0.2.45')
                .send({ email: 'different@example.com', password: 'short' }).expect(400);
        }
    });
}

test('IPv6 address rotation inside one /64 shares the IP rate budget', async () => {
    const app = makeApp({ ...config, trustedProxies: ['127.0.0.1', '::1'], ipLimit: 2 });
    for (let index = 0; index < 3; index++) {
        await request(app).post('/api/auth/login').set('Origin', config.origin)
            .set('X-Forwarded-For', `2001:db8::${index + 1}`)
            .send({ email: `ipv6${index}@example.com`, password: 'short' }).expect(index < 2 ? 400 : 429);
    }
});

test('unsupported JSON charset is a sanitized client error rather than an availability failure', async () => {
    await api(0, 'post', '/api/auth/login').set('Origin', config.origin)
        .set('Content-Type', 'application/json; charset=iso-8859-1').send('{}')
        .expect(415, { error: 'Unsupported JSON encoding' });
});

test('real initial connection failure retries and becomes ready after MongoDB starts', { timeout: 30000 }, async () => {
    const uri = database.getUri();
    await mongoose.disconnect();
    await database.stop({ doCleanup: false });
    const app = makeApp();
    const { startDatabaseLifecycle } = require('../src/services/databaseLifecycle');
    const lifecycle = startDatabaseLifecycle({ app, uri, retryMs: 25, log: () => {} });
    try {
        await lifecycle.initial;
        assert.equal(app.locals.authReady, false);
        await request(app).get('/health').expect(200);
        await request(app).get('/ready').expect(503);
        await request(app).post('/api/auth/register').set('Origin', config.origin).send(input).expect(503);
        await database.start(true);
        await eventually(() => app.locals.authReady);
        await request(app).get('/ready').expect(200);
        await request(app).post('/api/auth/register').set('Origin', config.origin).send(input).expect(201);
    } finally {
        lifecycle.stop();
        if (database.state !== 'running') await database.start(true);
        await eventually(() => mongoose.connection.readyState === 1);
    }
});

test('HTTPS logout clears the same secure host-only cookie and forwarded proto cannot downgrade it', async () => {
    const secure = loadAuthConfig({ AUTH_ENV: 'production', AUTH_ORIGIN: 'https://hotel.example' });
    const app = makeApp(secure);
    const registered = await request(app).post('/api/auth/register').set('Origin', secure.origin)
        .set('X-Forwarded-Proto', 'http').send(input).expect(201);
    const cookie = sessionCookie(registered);
    assert.match(registered.headers['set-cookie'][0], /; Secure/);
    const proof = (await request(app).get('/api/auth/csrf').set('Cookie', cookie).expect(200)).body.csrfToken;
    const response = await request(app).post('/api/auth/logout').set('Origin', secure.origin)
        .set('Cookie', cookie).set('X-CSRF-Token', proof).set('X-Forwarded-Proto', 'http').send({}).expect(204);
    const cleared = response.headers['set-cookie'][0];
    assert.match(cleared, /^__Host-p360_session=;/);
    assert.match(cleared, /; Path=\//);
    assert.match(cleared, /; HttpOnly/);
    assert.match(cleared, /; Secure/);
    assert.match(cleared, /; SameSite=Lax/);
    assert.doesNotMatch(cleared, /Domain=/);
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
});
