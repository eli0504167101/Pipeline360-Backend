const mongoose = require('mongoose');

const Reservation = require('../models/Reservation');
const Hotel = require('../models/Hotel');

const ownerFilter = userId => ({ userId, $expr: { $eq: [{ $type: '$userId' }, 'objectId'] } });

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

// Create a reservation owned exclusively by the authenticated session.
exports.createReservation = async (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
        if (Object.hasOwn(body, 'userId')) {
            return res.status(400).json({ error: 'Client-controlled userId is not allowed' });
        }
        const fullName = normalizeText(body.fullName);
        const email = normalizeText(body.email).toLowerCase();
        const hotelId = normalizeText(body.hotelId);
        const checkIn = new Date(body.checkIn);
        const checkOut = new Date(body.checkOut);

        if (!fullName || !email || !hotelId || !body.checkIn || !body.checkOut) {
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

        // Availability considers all reservations, including unowned legacy records.
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
            userId: req.auth.user._id,
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
        console.error('Failed to create reservation');

        if (error.code === 11000) {
            return res.status(409).json({
                error: 'Reservation conflict',
                details: 'A reservation with this ID already exists'
            });
        }

        return res.status(500).json({
            error: 'Failed to create reservation'
        });
    }
};

// List public hotel information.
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

// Look up one owned reservation by reservation ID, full name, or email.
exports.lookupReservation = async (req, res) => {
    try {
        const query = normalizeText(req.params.query);

        if (!query) {
            return res.status(400).json({
                message: 'Search value is required'
            });
        }

        const reservation = await Reservation.findOne({
            ...ownerFilter(req.auth.user._id),
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
        console.error('Lookup reservation failed');

        return res.status(500).json({
            error: 'Lookup reservation failed'
        });
    }
};

// Cancel only an owned reservation, including the legacy MongoDB ID fallback.
exports.cancelReservation = async (req, res) => {
    try {
        const id = normalizeText(req.params.id);

        if (!id) {
            return res.status(400).json({
                message: 'Reservation ID is required'
            });
        }

        let reservation = await Reservation.findOneAndDelete({
            reservationId: id,
            ...ownerFilter(req.auth.user._id)
        });

        if (!reservation && mongoose.isValidObjectId(id)) {
            reservation = await Reservation.findOneAndDelete({ _id: id, ...ownerFilter(req.auth.user._id) });
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
        console.error('Cancel reservation failed');

        return res.status(500).json({
            message: 'Server Error'
        });
    }
};