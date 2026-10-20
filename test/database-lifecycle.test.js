const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { startDatabaseLifecycle } = require('../src/services/databaseLifecycle');
const { setTimeout: delay } = require('node:timers/promises');

async function until(predicate) {
    for (let index = 0; index < 100; index++) {
        if (predicate()) return;
        await delay(5);
    }
    assert.fail('Lifecycle did not reach the expected state');
}
function fixture(initialize, log = () => {}) {
    const connection = new EventEmitter();
    connection.readyState = 0;
    const app = { locals: {} };
    const database = {
        connection,
        async connect() { connection.readyState = 1; connection.emit('connected'); }
    };
    const lifecycle = startDatabaseLifecycle({ app, uri: 'mongodb://test.invalid', database,
        initialize, retryMs: 10, log });
    return { app, database, connection, lifecycle };
}

test('startup index failure is retried without marking authentication ready', async () => {
    let calls = 0;
    const f = fixture(async () => { if (++calls === 1) throw new Error('index failure'); });
    try {
        await f.lifecycle.initial;
        assert.equal(f.app.locals.authReady, false);
        await until(() => f.app.locals.authReady);
        assert.equal(calls, 2);
    } finally { f.lifecycle.stop(); }
});

test('initial connection failure is retried rather than leaving a permanently unready process', async () => {
    const connection = new EventEmitter();
    connection.readyState = 0;
    const app = { locals: {} };
    let attempts = 0;
    const database = { connection, async connect() {
        if (++attempts === 1) throw new Error('unavailable');
        connection.readyState = 1;
        connection.emit('connected');
    } };
    const lifecycle = startDatabaseLifecycle({ app, uri: 'mongodb://test.invalid', database,
        initialize: async () => {}, retryMs: 10, log: () => {} });
    try {
        await lifecycle.initial;
        assert.equal(app.locals.authReady, false);
        await until(() => app.locals.authReady);
        assert.equal(attempts, 2);
    } finally { lifecycle.stop(); }
});

test('disconnect closes auth immediately; driver reconnect must revalidate indexes', async () => {
    let calls = 0;
    let release;
    const f = fixture(async () => {
        if (++calls === 2) await new Promise(resolve => { release = resolve; });
    });
    try {
        await f.lifecycle.initial;
        assert.equal(f.app.locals.authReady, true);
        f.connection.readyState = 0;
        f.connection.emit('disconnected');
        assert.equal(f.app.locals.authReady, false);
        f.connection.readyState = 1;
        f.connection.emit('connected');
        assert.equal(f.app.locals.authReady, false);
        release();
        await until(() => f.app.locals.authReady);
        assert.equal(calls, 2);
    } finally { f.lifecycle.stop(); }
});

test('a disconnect during index initialization cannot publish stale readiness', async () => {
    let release;
    const f = fixture(() => new Promise(resolve => { release = resolve; }));
    try {
        await until(() => Boolean(release));
        f.connection.readyState = 0;
        f.connection.emit('disconnected');
        release();
        await f.lifecycle.initial;
        assert.equal(f.app.locals.authReady, false);
    } finally { f.lifecycle.stop(); }
});

test('database error events are handled and sensitive exception details are not logged', async () => {
    const logs = [];
    const f = fixture(async () => {}, message => logs.push(message));
    try {
        await f.lifecycle.initial;
        f.connection.emit('error', new Error('sensitive connection detail'));
        assert.equal(logs.some(message => message.includes('sensitive connection detail')), false);
        assert.equal(f.app.locals.authReady, false);
        await until(() => f.app.locals.authReady);
    } finally { f.lifecycle.stop(); }
});

test('stopped lifecycle removes listeners and cannot restore readiness from an in-flight initializer', async () => {
    let release;
    const f = fixture(() => new Promise(resolve => { release = resolve; }));
    await until(() => Boolean(release));
    f.lifecycle.stop();
    release();
    await f.lifecycle.initial;
    assert.equal(f.app.locals.authReady, false);
    for (const event of ['error', 'connected', 'disconnected']) assert.equal(f.connection.listenerCount(event), 0);
});
