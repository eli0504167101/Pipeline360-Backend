
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
    app.use(express.json());

    // Liveness checks the HTTP server independently of database readiness.
    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'healthy'
        });
    });

    // Readiness requires MongoDB and authentication indexes to be available.
    app.get('/ready', (req, res) => {
        if (mongoose.connection.readyState !== 1 || app.locals.authReady === false) {
            return res.status(503).json({
                status: 'not ready',
                database: 'disconnected'
            });
        }

        res.status(200).json({
            status: 'ready',
            database: 'connected'
        });
    });

    // Preserve the existing reservation routes.
    app.use('/api/reservations', reservationRoutes);

    return app;
}

// Keep the reservation regression app import free of startup/configuration side effects.
module.exports = createApp();
module.exports.createApp = createApp;
