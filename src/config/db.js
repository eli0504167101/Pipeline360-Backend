const mongoose = require('mongoose');
// דוגמה לשימוש במשתנה סביבה (הדרך הנכונה)
const dbName = process.env.DB_NAME || 'Pipeline360_PROD';
const mongoURI = `mongodb://db-user:db-password@mongodb:27017/${dbName}?authSource=admin`;

// בקובץ config/db.js
const connectDB = async () => {
    try {
        // שים לב לחלק האחרון ב-URL: כאן אתה מגדיר את שם ה-DB
        // שנה את השורה הזו בקובץ config/db.js
        await mongoose.connect('mongodb://mongodb:27017/Pipeline360_PROD'); 
        console.log("Connected to the NEW production database");
    } catch (err) {
        console.error(err.message);
    }
};

module.exports = connectDB;