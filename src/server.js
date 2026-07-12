const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const Reservation = require('./models/Reservation');
const reservationRoutes = require('./routes/reservationRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// פו  שתחכה לחיבור ל-DB
const startServer = async () => {
    await connectDB();
    console.log("Starting test write...");
    
    try {
        const testRes = new Reservation({ 
            fullName: "FORCE_TEST", 
            email: "test@force.com", 
            hotelId: "999",
            checkIn: new Date(),
            checkOut: new Date()
        });
        const saved = await testRes.save();
        console.log("SUCCESS! Document created:", saved._id);
    } catch (err) {
        console.error("CRITICAL ERROR during save:", err);
    }

    app.use('/api/reservations', reservationRoutes);
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
};
startServer();