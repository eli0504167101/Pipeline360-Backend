
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const reservationRoutes = require('./routes/reservationRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// Liveness Probe:
// בודק רק שהשרת עצמו חי
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy'
    });
});

// Readiness Probe:
// בודק גם שהחיבור ל-MongoDB מוכן.
app.get('/ready', (req, res) => {
    if (mongoose.connection.readyState !== 1) {
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

// נתיבי ה-API
app.use('/api/reservations', reservationRoutes);

module.exports = app;
