const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server-core');
const { createApp } = require('../src/app');
const { loadAuthConfig } = require('../src/config/auth');
const { initializeAuthDatabase } = require('../src/services/authDatabase');
const { migrateReservationOwnership } = require('../src/services/reservationMigration');
const User = require('../src/models/User');
const Session = require('../src/models/Session');
const AuthRateLimit = require('../src/models/AuthRateLimit');
const Hotel = require('../src/models/Hotel');
const Reservation = require('../src/models/Reservation');
const config = loadAuthConfig({ AUTH_ENV: 'local', AUTH_ORIGIN: 'http://hotel.local:3000' });
const input = { fullName: 'Booking Guest', email: 'booking@example.com', hotelId: 'HOTEL-OWNERSHIP', checkIn: '2030-07-01', checkOut: '2030-07-03' };
let server;
let apps;
function call(method, path, actor, index = 0) {
    const result = request(apps[index])[method](path).timeout({ response: 5000, deadline: 10000 });
    if (actor) result.set('Cookie', actor.cookie).set('Origin', config.origin).set('X-CSRF-Token', actor.csrf);
    return result;
}
async function account(email) {
    const response = await call('post', '/api/auth/register').set('Origin', config.origin)
        .send({ fullName: 'Matching Guest', email, password: 'A long testing password!' }).expect(201);
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    const csrf = (await request(apps[1]).get('/api/auth/csrf').set('Cookie', cookie).expect(200)).body.csrfToken;
    return { cookie, csrf, id: response.body.user.id, email };
}
async function book(actor, extra = {}) {
    return (await call('post', '/api/reservations', actor).send({ ...input, ...extra }).expect(201)).body.reservationId;
}
async function legacy(extra = {}) {
    const document = { ...input, checkIn: new Date(input.checkIn), checkOut: new Date(input.checkOut),
        reservationId: `LEGACY-${new mongoose.Types.ObjectId()}`, createdAt: new Date('2020-01-01'),
        updatedAt: new Date('2020-01-02'), customHistoricalField: 'preserve-me', ...extra };
    await Reservation.collection.insertOne(document);
    return document;
}

before(async () => {
    // Never consume MONGO_URL: all data belongs to a disposable local process.
    server = await MongoMemoryServer.create({
        binary: { version: '7.0.24', downloadDir: require('node:path').join(require('node:os').tmpdir(), 'pipeline360-mongodb-binaries') },
        instance: { dbName: 'pipeline360_ownership_test', ip: '127.0.0.1' }
    });
    await mongoose.connect(server.getUri('pipeline360_ownership_test'), { monitorCommands: true });
    await initializeAuthDatabase();
    await Promise.all([Reservation.init(), Hotel.init()]);
    apps = Array.from({ length: 5 }, () => { const app = createApp(config); app.set('env', 'test'); return app; });
}, { timeout: 180000 });
after(async () => { await mongoose.disconnect(); if (server) await server.stop(); });
beforeEach(async () => {
    await Promise.all([User, Session, AuthRateLimit, Reservation, Hotel].map(model => model.deleteMany({})));
    await Hotel.create({ hotelId: input.hotelId, hotelName: 'Ownership Test Hotel', pricePerNight: 100 });
});

test('Free user creation persists only the session owner despite unrelated guest name/email', async () => {
    const alice = await account('alice@example.com');
    const bob = await account('bob@example.com');
    const id = await book(alice, { fullName: 'Matching Guest', email: bob.email });
    const stored = await Reservation.collection.findOne({ reservationId: id });
    assert.equal(stored.userId._bsontype, 'ObjectId');
    assert.equal(String(stored.userId), alice.id);
    assert.equal(stored.email, bob.email);
    await Reservation.updateOne({ reservationId: id }, { $set: { userId: new mongoose.Types.ObjectId(bob.id) } });
    assert.equal(String((await Reservation.collection.findOne({ reservationId: id })).userId), alice.id);
    for (let index = 0; index < 5; index++) {
        const response = await call('get', `/api/reservations/lookup/${id}`, alice, index).expect(200);
        assert.equal(response.body.userId, alice.id);
        assert.equal(response.headers['cache-control'], 'no-store');
    }
    assert.equal((await User.findById(alice.id)).subscriptionTier, 'free');
});

test('anonymous creation, lookup and deletion are all rejected while hotels remain public', async () => {
    const alice = await account('alice@example.com');
    const id = await book(alice);
    await call('get', '/api/reservations/hotels').expect(200);
    await call('post', '/api/reservations').send(input).expect(401);
    await call('get', `/api/reservations/lookup/${id}`).expect(401);
    await call('delete', `/api/reservations/${id}`).send({}).expect(401);
    assert.equal(await Reservation.countDocuments(), 1);
});

for (const value of ['507f1f77bcf86cd799439011', null, { $ne: null }, ['507f1f77bcf86cd799439011']]) {
    test(`creation rejects a client-owned userId field (${JSON.stringify(value)})`, async () => {
        const alice = await account('alice@example.com');
        await call('post', '/api/reservations', alice).send({ ...input, userId: value })
            .expect(400, { error: 'Client-controlled userId is not allowed' });
        assert.equal(await Reservation.countDocuments(), 0);
    });
}

test('query-string identity cannot override ownership', async () => {
    const alice = await account('alice@example.com');
    const bob = await account('bob@example.com');
    await call('post', '/api/reservations', alice).send({ ...input, userId: alice.id }).expect(400);
    const response = await call('post', `/api/reservations?userId=${bob.id}`, alice).send(input).expect(201);
    assert.equal(String((await Reservation.findOne({ reservationId: response.body.reservationId })).userId), alice.id);
});

test('forged identity in lookup or cancellation cannot access another user reservation', async () => {
    const alice = await account('alice@example.com');
    const bob = await account('bob@example.com');
    const id = await book(alice, { email: bob.email, fullName: 'Matching Guest' });
    const stored = await Reservation.findOne({ reservationId: id });
    for (const query of [id, bob.email, 'Matching Guest']) {
        await call('get', `/api/reservations/lookup/${encodeURIComponent(query)}?userId=${alice.id}`, bob)
            .expect(404, { message: 'Reservation not found' });
    }
    for (const identifier of [id, String(stored._id)]) {
        await call('delete', `/api/reservations/${identifier}`, bob).send({ userId: alice.id })
            .expect(404, { message: 'Reservation not found' });
    }
    assert.equal(await Reservation.countDocuments(), 1);
});

for (const rawType of ['missing', 'null', 'string', 'array']) {
    test(`legacy ${rawType} owner remains inaccessible despite matching account name/email`, async () => {
        const alice = await account('alice@example.com');
        const extra = { email: alice.email, fullName: 'Matching Guest' };
        if (rawType !== 'missing') extra.userId = rawType === 'null' ? null : rawType === 'string' ? alice.id : [new mongoose.Types.ObjectId(alice.id)];
        const old = await legacy(extra);
        for (const query of [old.reservationId, old.email, old.fullName]) {
            await call('get', `/api/reservations/lookup/${encodeURIComponent(query)}`, alice).expect(404);
        }
        for (const identifier of [old.reservationId, String(old._id)]) {
            await call('delete', `/api/reservations/${identifier}`, alice).send({}).expect(404);
        }
        assert.deepEqual(await Reservation.collection.findOne({ _id: old._id }), old);
    });
}

test('owner can cancel by reservation ID or MongoDB ID; the fallback remains scoped', async () => {
    const alice = await account('alice@example.com');
    const first = await book(alice);
    await call('delete', `/api/reservations/${first}`, alice).send({}).expect(200);
    const second = await book(alice);
    const document = await Reservation.findOne({ reservationId: second });
    await call('delete', `/api/reservations/${document._id}`, alice, 3).send({}).expect(200);
    assert.equal(await Reservation.countDocuments(), 0);
});

test('legacy reservations still block overlapping availability without exposing their details', async () => {
    const old = await legacy();
    const alice = await account('alice@example.com');
    const response = await call('post', '/api/reservations', alice).send(input).expect(409);
    assert.equal(JSON.stringify(response.body).includes(old.reservationId), false);
    assert.equal(await Reservation.countDocuments(), 1);
});

test('creation and cancellation require both trusted Origin and session CSRF proof', async () => {
    const alice = await account('alice@example.com');
    for (const method of ['post', 'delete']) {
        const path = method === 'post' ? '/api/reservations' : '/api/reservations/any';
        await call(method, path, alice).set('X-CSRF-Token', 'wrong').send(input).expect(403);
        await call(method, path, alice).set('Origin', 'https://attacker.example').send(input).expect(403);
        await request(apps[0])[method](path).set('Cookie', alice.cookie).set('Origin', config.origin).send(input).expect(403);
    }
    assert.equal(await Reservation.countDocuments(), 0);
});

test('expired sessions cannot create, look up or cancel', async () => {
    const alice = await account('alice@example.com');
    const id = await book(alice);
    await Session.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await call('post', '/api/reservations', alice).send(input).expect(401);
    await call('get', `/api/reservations/lookup/${id}`, alice).expect(401);
    await call('delete', `/api/reservations/${id}`, alice).send({}).expect(401);
    assert.equal(await Reservation.countDocuments(), 1);
});

test('protected reservation routes fail closed until auth initialization is ready', async () => {
    const app = createApp(config);
    app.locals.authReady = false;
    await request(app).post('/api/reservations').send(input).expect(503);
    await request(app).get('/api/reservations/lookup/any').expect(503);
    await request(app).delete('/api/reservations/any').send({}).expect(503);
});

test('unconfigured app factory cannot accidentally expose reservation data', async () => {
    const app = createApp();
    await request(app).post('/api/reservations').send(input).expect(401);
    await request(app).get('/api/reservations/lookup/any').expect(401);
    await request(app).delete('/api/reservations/any').expect(401);
});

test('migration dry-run changes no documents, hotels, timestamps or indexes and reports anomalies', async () => {
    const alice = await account('alice@example.com');
    await legacy();
    await legacy({ userId: null });
    await legacy({ userId: new mongoose.Types.ObjectId(alice.id) });
    await legacy({ userId: new mongoose.Types.ObjectId() });
    await legacy({ userId: alice.id });
    await legacy({ userId: [new mongoose.Types.ObjectId(alice.id)] });
    const snapshot = await Reservation.collection.find().sort({ _id: 1 }).toArray();
    const hotels = await Hotel.collection.find().toArray();
    const indexes = await Reservation.collection.indexes();
    const writes = [];
    const observe = event => { if (['insert', 'update', 'delete', 'create', 'createIndexes', 'drop'].includes(event.commandName)) writes.push(event.commandName); };
    const client = mongoose.connection.getClient();
    client.on('commandStarted', observe);
    let report;
    try { report = await migrateReservationOwnership(mongoose.connection.db); }
    finally { client.off('commandStarted', observe); }
    assert.deepEqual(writes, []);
    assert.deepEqual(report.before, { total: 6, missingOwner: 1, nullOwner: 1, owned: 2, invalidOwnerType: 2, orphanedOwner: 1 });
    assert.equal(report.mode, 'dry-run');
    assert.equal(report.modified, 0);
    assert.deepEqual(await Reservation.collection.find().sort({ _id: 1 }).toArray(), snapshot);
    assert.deepEqual(await Hotel.collection.find().toArray(), hotels);
    assert.deepEqual(await Reservation.collection.indexes(), indexes);
    assert.equal(JSON.stringify(report).includes(alice.email), false);
});

test('migration apply only normalizes missing owners, preserves data, and is repeatable', async () => {
    const alice = await account('alice@example.com');
    const old = await legacy({ email: alice.email, fullName: 'Matching Guest' });
    const alreadyNull = await legacy({ userId: null });
    const owned = await legacy({ userId: new mongoose.Types.ObjectId(alice.id) });
    const invalid = await legacy({ userId: alice.id });
    const beforeHotels = await Hotel.collection.find().toArray();
    const first = await migrateReservationOwnership(mongoose.connection.db, { apply: true });
    assert.equal(first.modified, 1);
    assert.equal(first.after.missingOwner, 0);
    assert.equal(first.after.nullOwner, 2);
    assert.deepEqual(await Reservation.collection.findOne({ _id: old._id }), { ...old, userId: null });
    for (const item of [alreadyNull, owned, invalid]) assert.deepEqual(await Reservation.collection.findOne({ _id: item._id }), item);
    const second = await migrateReservationOwnership(mongoose.connection.db, { apply: true });
    assert.equal(second.modified, 0);
    assert.deepEqual(first.after, second.after);
    assert.deepEqual(await Hotel.collection.find().toArray(), beforeHotels);
    await call('get', `/api/reservations/lookup/${old.reservationId}`, alice).expect(404);
    await call('delete', `/api/reservations/${old._id}`, alice).send({}).expect(404);
    assert.equal(await Reservation.countDocuments(), 4);
});

test('migration preserves a previously verified owner', async () => {
    const alice = await account('alice@example.com');
    const old = await legacy();
    // Model the owner having been set by a separately authorized verification workflow.
    await Reservation.collection.updateOne({ _id: old._id }, { $set: { userId: new mongoose.Types.ObjectId(alice.id) } });
    const report = await migrateReservationOwnership(mongoose.connection.db, { apply: true });
    assert.equal(report.modified, 0);
    assert.equal(String((await Reservation.collection.findOne({ _id: old._id })).userId), alice.id);
});

test('migration CLI defaults to dry-run and refuses conflicting flags without database access', async () => {
    const { spawn } = require('node:child_process');
    function execute(args, env) {
        return new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['scripts/migrate-reservation-ownership.js', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '', stderr = '';
            child.stdout.on('data', data => { stdout += data; });
            child.stderr.on('data', data => { stderr += data; });
            child.on('error', reject);
            child.on('close', code => resolve({ code, stdout, stderr }));
        });
    }
    const old = await legacy();
    const result = await execute([], { PATH: process.env.PATH, MONGO_URL: server.getUri('pipeline360_ownership_test') });
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.stdout).mode, 'dry-run');
    assert.deepEqual(await Reservation.collection.findOne({ _id: old._id }), old);
    const missingConfirmation = await execute(['--apply'], { PATH: process.env.PATH, MONGO_URL: server.getUri('pipeline360_ownership_test') });
    assert.equal(missingConfirmation.code, 1);
    assert.deepEqual(await Reservation.collection.findOne({ _id: old._id }), old);
    const applied = await execute(['--apply', '--confirm-database', 'pipeline360_ownership_test'],
        { PATH: process.env.PATH, MONGO_URL: server.getUri('pipeline360_ownership_test') });
    assert.equal(applied.code, 0);
    assert.equal(JSON.parse(applied.stdout).modified, 1);
    const repeated = await execute(['--apply', '--confirm-database', 'pipeline360_ownership_test'],
        { PATH: process.env.PATH, MONGO_URL: server.getUri('pipeline360_ownership_test') });
    assert.equal(repeated.code, 0);
    assert.equal(JSON.parse(repeated.stdout).modified, 0);
    const invalid = await execute(['--apply', '--dry-run'], { PATH: process.env.PATH });
    assert.equal(invalid.code, 1);
    assert.equal(invalid.stdout, '');
    assert.equal(invalid.stderr.includes('mongodb://'), false);
});

test('ownership writes, cancellation and migration send majority acknowledgement to MongoDB', async () => {
    const alice = await account('alice@example.com');
    await legacy({ hotelId: 'OLD-HOTEL' });
    const observed = [];
    const listener = event => {
        const command = event.command;
        const collection = command.insert || command.findAndModify || command.update;
        if (collection === 'reservations') observed.push({ name: event.commandName,
            writeConcern: command.writeConcern, maxTimeMS: command.maxTimeMS });
    };
    const client = mongoose.connection.getClient();
    client.on('commandStarted', listener);
    try {
        const id = await book(alice);
        await call('delete', `/api/reservations/${id}`, alice).send({}).expect(200);
        await migrateReservationOwnership(mongoose.connection.db, { apply: true });
        for (const name of ['insert', 'findAndModify', 'update']) {
            const commands = observed.filter(command => command.name === name);
            assert.ok(commands.length > 0, `Missing reservation wire command: ${name}`);
            for (const command of commands) assert.deepEqual(command.writeConcern, { w: 'majority', wtimeout: 5000 });
        }
        assert.equal(observed.find(command => command.name === 'update').maxTimeMS, 30000);
    } finally { client.off('commandStarted', listener); }
});

test('dry-run on an empty database creates no collections', async () => {
    const empty = mongoose.connection.getClient().db('pipeline360_empty_migration_test');
    assert.deepEqual(await empty.listCollections().toArray(), []);
    const result = await migrateReservationOwnership(empty);
    assert.deepEqual(result.before, { total: 0, missingOwner: 0, nullOwner: 0, owned: 0, invalidOwnerType: 0, orphanedOwner: 0 });
    assert.deepEqual(await empty.listCollections().toArray(), []);
});


test('logout revocation prevents creation, lookup and cancellation through every entry point', async () => {
    const alice = await account('alice@example.com');
    const id = await book(alice);
    await call('post', '/api/auth/logout', alice).send({}).expect(204);
    await call('post', '/api/reservations', alice).send(input).expect(401);
    await call('get', `/api/reservations/lookup/${id}`, alice, 1).expect(401);
    await call('delete', `/api/reservations/${id}`, alice, 2).send({}).expect(401);
    assert.equal(await Reservation.countDocuments(), 1);
});
