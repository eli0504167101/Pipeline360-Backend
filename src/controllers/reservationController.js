const Reservation = require('../models/Reservation');

// 1. יצירת הזמנה
exports.createReservation = async (req, res) => {
  try {
    const { fullName, email, checkIn, checkOut, hotelId } = req.body;
    const reservationId = 'res_' + Date.now();
    const newReservation = new Reservation({ reservationId, fullName, email, checkIn, checkOut, hotelId });
    await newReservation.save();
    res.status(201).json({ message: "Reservation created successfully", id: reservationId });
  } catch (error) {
    res.status(500).json({ error: "Failed to create reservation", details: error.message });
  }
};

// 2. קבלת מלונות
exports.getHotels = async (req, res) => {
  try {
    // מניח שיש לך מודל Hotel, אם לא תשתמש ב-db.collection ישירות
    const hotels = await db.collection('hotels').find().toArray();
    res.json(hotels);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch hotels" });
  }
};

// 3. חיפוש הזמנה
exports.lookupReservation = async (req, res) => {
  try {
    const { query } = req.params;
    const reservation = await Reservation.findOne({ $or: [{ fullName: query }, { email: query }] });
    if (!reservation) return res.status(404).json({ message: "Reservation not found" });
    res.status(200).json(reservation);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

// 4. ביטול הזמנה
exports.cancelReservation = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await Reservation.findByIdAndDelete(id);
    if (!result) return res.status(404).json({ message: "Reservation not found" });
    res.status(200).json({ message: "Reservation cancelled successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};