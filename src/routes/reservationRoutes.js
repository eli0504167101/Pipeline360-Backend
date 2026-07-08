const express = require('express');
const router = express.Router();
const Reservation = require('../models/Reservation');
const reservationController = require('../controllers/reservationController');

// הוסף את השורה הזו כדי לראות מה ה-Node.js רואה באמת:
console.log("Controller content:", reservationController);

router.get('/lookup/:query', reservationController.lookupReservation);
router.delete('/:id', reservationController.cancelReservation);
// בתוך routes/reservationRoutes.js
router.post('/', async (req, res) => {
    try {
        const newReservation = new Reservation({
            fullName: req.body.fullName,
            email: req.body.email,
            checkIn: req.body.checkIn,
            checkOut: req.body.checkOut,
            hotelId: req.body.hotelId
        });
        await newReservation.save();
        res.status(201).json(newReservation);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;