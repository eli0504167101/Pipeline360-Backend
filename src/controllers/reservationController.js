const mongoose = require('mongoose');

const Reservation = require('../models/Reservation');
const Hotel = require('../models/Hotel');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function createReservationId() {
    return `RES-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase()}`;
}

// יצירת הזמנה
exports.createReservation = async (req, res) => {
    try {
        const fullName = normalizeText(req.body.fullName);
        const email = normalizeText(req.body.email).toLowerCase();
        const hotelId = normalizeText(req.body.hotelId);
        const checkIn = new Date(req.body.checkIn);
        const checkOut = new Date(req.body.checkOut);

        if (!fullName || !email || !hotelId || !req.body.checkIn || !req.body.checkOut) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'All reservation fields are required'
            });
        }

        if (!EMAIL_PATTERN.test(email)) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'Email address is invalid'
            });
        }

        if (
            Number.isNaN(checkIn.getTime()) ||
            Number.isNaN(checkOut.getTime())
        ) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'Check-in and check-out dates must be valid'
            });
        }

        if (checkOut <= checkIn) {
            return res.status(400).json({
                error: 'Validation failed',
                details: 'Check-out date must be after check-in date'
            });
        }

        const hotel = await Hotel.findOne({ hotelId });

        if (!hotel) {
            return res.status(404).json({
                error: 'Hotel not found',
                details: `Hotel '${hotelId}' does not exist`
            });
        }

        // חפיפה קיימת כאשר:
        // הזמנה קיימת מתחילה לפני תאריך היציאה החדש,
        // ומסתיימת אחרי תאריך הכניסה החדש.
        const conflictingReservation = await Reservation.findOne({
            hotelId,
            checkIn: { $lt: checkOut },
            checkOut: { $gt: checkIn }
        });

        if (conflictingReservation) {
            return res.status(409).json({
                error: 'Dates are unavailable',
                details: 'The selected hotel is already reserved for these dates'
            });
        }

        const reservationId = createReservationId();

        const newReservation = new Reservation({
            reservationId,
            fullName,
            email,
            checkIn,
            checkOut,
            hotelId
        });

        await newReservation.save();

        return res.status(201).json({
            message: 'Reservation created successfully',
            id: reservationId,
            reservationId
        });
    } catch (error) {
        console.error('Failed to create reservation:', error.message);

        if (error.code === 11000) {
            return res.status(409).json({
                error: 'Reservation conflict',
                details: 'A reservation with this ID already exists'
            });
        }

        return res.status(500).json({
            error: 'Failed to create reservation',
            details: error.message
        });
    }
};

// קבלת מלונות
exports.getHotels = async (req, res) => {
    try {
        const hotels = await Hotel.find();

        return res.status(200).json(hotels);
    } catch (error) {
        console.error('Failed to fetch hotels:', error.message);

        return res.status(500).json({
            error: 'Failed to fetch hotels',
            details: error.message
        });
    }
};

// חיפוש לפי Reservation ID, שם מלא או אימייל
exports.lookupReservation = async (req, res) => {
    try {
        const query = normalizeText(req.params.query);

        if (!query) {
            return res.status(400).json({
                message: 'Search value is required'
            });
        }

        const reservation = await Reservation.findOne({
            $or: [
                { reservationId: query },
                { fullName: query },
                { email: query.toLowerCase() }
            ]
        });

        if (!reservation) {
            return res.status(404).json({
                message: 'Reservation not found'
            });
        }

        return res.status(200).json(reservation);
    } catch (error) {
        console.error('Lookup reservation failed:', error.message);

        return res.status(500).json({
            error: 'Lookup reservation failed',
            details: error.message
        });
    }
};

// ביטול לפי Reservation ID.
// נשמר fallback זמני ל-MongoDB _id עבור הזמנות ישנות.
exports.cancelReservation = async (req, res) => {
    try {
        const id = normalizeText(req.params.id);

        if (!id) {
            return res.status(400).json({
                message: 'Reservation ID is required'
            });
        }

        let reservation = await Reservation.findOneAndDelete({
            reservationId: id
        });

        if (!reservation && mongoose.isValidObjectId(id)) {
            reservation = await Reservation.findByIdAndDelete(id);
        }

        if (!reservation) {
            return res.status(404).json({
                message: 'Reservation not found'
            });
        }

        return res.status(200).json({
            message: 'Reservation cancelled successfully',
            reservationId: reservation.reservationId
        });
    } catch (error) {
        console.error('Cancel reservation failed:', error.message);

        return res.status(500).json({
            message: 'Server Error',
            details: error.message
        });
    }
};