const mongoose = require('mongoose');
const app = require('./app');

const PORT = process.env.PORT || 3000;
const dbURI = process.env.MONGO_URL;

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

