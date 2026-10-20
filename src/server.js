const mongoose = require('mongoose');
const { loadAuthConfig } = require('./config/auth');
const { initializeAuthDatabase } = require('./services/authDatabase');
const config = loadAuthConfig();
const app = require('./app').createApp(config);
app.locals.authReady = false;

const PORT = process.env.PORT || 3000;
const dbURI = process.env.MONGO_URL;

const connectDB = async () => {
    if (!dbURI) {
        throw new Error('MONGO_URL environment variable is not defined');
    }

    await mongoose.connect(dbURI);
    await initializeAuthDatabase();
    app.locals.authReady = true;

    console.log('MongoDB connected successfully');
};

const startServer = async () => {
    // Keep liveness available while database initialization is in progress.
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
    });

    try {
        await connectDB();
    } catch (error) {
        console.error('Database initialization failed');
    }
};

startServer();

