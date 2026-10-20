const mongoose = require('mongoose');
const { initializeAuthDatabase } = require('./authDatabase');

const CONNECTION_OPTIONS = Object.freeze({
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 15000,
    heartbeatFrequencyMS: 2000
});

function startDatabaseLifecycle({ app, uri, database = mongoose,
    initialize = initializeAuthDatabase, retryMs = 5000, log = console.error }) {
    const connection = database.connection;
    let stopped = false;
    let running = false;
    let connectedOnce = connection.readyState === 1;
    let generation = 0;
    let timer;
    app.locals.authReady = false;

    function schedule() {
        if (stopped || timer) return;
        timer = setTimeout(() => {
            timer = undefined;
            void reconcile();
        }, retryMs);
        timer.unref();
    }
    function invalidate() {
        generation++;
        app.locals.authReady = false;
    }
    async function reconcile() {
        if (stopped || running) return;
        running = true;
        try {
            if (connection.readyState !== 1) {
                // Initial connection failures are not retried by Mongoose.
                // Once connected, let the driver's topology monitor reconnect.
                if (connectedOnce) return;
                await database.connect(uri, CONNECTION_OPTIONS);
            }
            const current = generation;
            await initialize();
            if (!stopped && current === generation && connection.readyState === 1) {
                app.locals.authReady = true;
            }
        } catch {
            invalidate();
            log('Database initialization or recovery failed; retrying');
        } finally {
            running = false;
            if (!stopped && !app.locals.authReady) schedule();
        }
    }
    function connected() {
        connectedOnce = true;
        invalidate();
        void reconcile();
    }
    function disconnected() {
        invalidate();
        schedule();
    }
    function error() {
        invalidate();
        log('Database connection error; authentication unavailable');
        schedule();
    }
    connection.on('connected', connected);
    connection.on('disconnected', disconnected);
    connection.on('error', error);
    const initial = reconcile();

    return {
        initial,
        stop() {
            stopped = true;
            invalidate();
            clearTimeout(timer);
            connection.off('connected', connected);
            connection.off('disconnected', disconnected);
            connection.off('error', error);
        }
    };
}
module.exports = { startDatabaseLifecycle, CONNECTION_OPTIONS };
