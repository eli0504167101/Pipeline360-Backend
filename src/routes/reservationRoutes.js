const express = require('express');
const router = express.Router();

const reservationController = require('../controllers/reservationController');


router.get('/hotels', reservationController.getHotels);


router.get('/lookup/:query', reservationController.lookupReservation);


router.post('/', reservationController.createReservation);


router.delete('/:id', reservationController.cancelReservation);

module.exports = router;