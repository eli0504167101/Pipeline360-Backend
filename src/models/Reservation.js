const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema({
  reservationId: {
    type: String,
    default: () => 'RES-' + Math.random().toString(36).substr(2, 9).toUpperCase() // יצירת ID אוטומטי
},
  fullName: { type: String, required: true },
  email: { type: String, required: true },
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  hotelId: { type: String, required: true }
});

module.exports = mongoose.model('Reservation', reservationSchema);