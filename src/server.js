
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const reservationRoutes = require('./routes/reservationRoutes');

const app = express();

const PORT = process.env.PORT || 3000;
const dbURI = process.env.MONGO_URL;

app.use(cors());
app.use(express.json());

// Liveness Probe:
// בודק רק שהשרת עצמו חי ומגיב.
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

const connectDB = async () => {
    if (!dbURI) {
        throw new Error('MONGO_URL environment variable is not defined');
    }

    await mongoose.connect(dbURI);

    console.log('MongoDB connected successfully');
};

const startServer = async () => {
    // מפעילים את שרת Express מיד,
    // כדי שה-liveness probe יוכל לקבל תשובה.
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
    });

    try {
        await connectDB();
    } catch (error) {
        console.error('MongoDB connection error:', error.message);
    }
};

startServer();

