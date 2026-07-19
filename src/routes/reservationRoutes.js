const express = require('express');
const router = express.Router();

const reservationController = require('../controllers/reservationController');

// מלונות
router.get('/hotels', reservationController.getHotels);

// חיפוש הזמנה לפי שם או אימייל
router.get('/lookup/:query', reservationController.lookupReservation);

// יצירת הזמנה
router.post('/', reservationController.createReservation);

// ביטול הזמנה
router.delete('/:id', reservationController.cancelReservation);

module.exports = router;