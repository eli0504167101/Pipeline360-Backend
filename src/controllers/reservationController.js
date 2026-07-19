const Reservation = require('../models/Reservation');
const Hotel = require('../models/Hotel');

// יצירת הזמנה
exports.createReservation = async (req, res) => {
    try {
        const {
            fullName,
            email,
            checkIn,
            checkOut,
            hotelId
        } = req.body;

        const reservationId = `res_${Date.now()}`;

        const newReservation = new Reservation({
            reservationId,
            fullName,
            email,
            checkIn,
            checkOut,
            hotelId
        });

        await newReservation.save();

        res.status(201).json({
            message: 'Reservation created successfully',
            id: reservationId
        });
    } catch (error) {
        console.error('Failed to create reservation:', error.message);

        res.status(500).json({
            error: 'Failed to create reservation',
            details: error.message
        });
    }
};

// קבלת מלונות
exports.getHotels = async (req, res) => {
    try {
        const hotels = await Hotel.find();

        res.status(200).json(hotels);
    } catch (error) {
        console.error('Failed to fetch hotels:', error.message);

        res.status(500).json({
            error: 'Failed to fetch hotels',
            details: error.message
        });
    }
};

// חיפוש הזמנה
exports.lookupReservation = async (req, res) => {
    try {
        const query = req.params.query;

        const reservation = await Reservation.findOne({
            $or: [
                { fullName: query },
                { email: query }
            ]
        });

        if (!reservation) {
            return res.status(404).json({
                message: 'Reservation not found'
            });
        }

        res.status(200).json(reservation);
    } catch (error) {
        console.error('Lookup reservation failed:', error.message);

        res.status(500).json({
            error: error.message
        });
    }
};

// ביטול הזמנה
exports.cancelReservation = async (req, res) => {
    try {
        const { id } = req.params;

        const result = await Reservation.findByIdAndDelete(id);

        if (!result) {
            return res.status(404).json({
                message: 'Reservation not found'
            });
        }

        res.status(200).json({
            message: 'Reservation cancelled successfully'
        });
    } catch (error) {
        console.error('Cancel reservation failed:', error.message);

        res.status(500).json({
            message: 'Server Error',
            details: error.message
        });
    }
};