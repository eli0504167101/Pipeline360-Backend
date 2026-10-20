
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const reservationRoutes = require('./routes/reservationRoutes');

function createApp(authConfig) {
    const app = express();
    if (authConfig) {
        app.set('trust proxy', authConfig.trustedProxies);
        app.use('/api/auth', require('./routes/authRoutes')(authConfig));
    }

    app.use(cors());
    app.use('/api/reservations', reservationRoutes(authConfig));
    app.use(express.json());

    // Liveness checks the HTTP server independently of database readiness.
    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'healthy'
        });
    });

    // Readiness requires MongoDB and authentication indexes to be available.
    app.get('/ready', (req, res) => {
        const connected = mongoose.connection.readyState === 1;
        if (!connected || app.locals.authReady === false) {
            return res.status(503).json({
                status: 'not ready',
                database: connected ? 'connected' : 'disconnected'
            });
        }

        res.status(200).json({
            status: 'ready',
            database: 'connected'
        });
    });

    return app;
}

// Keep the reservation regression app import free of startup/configuration side effects.
module.exports = createApp();
module.exports.createApp = createApp;
