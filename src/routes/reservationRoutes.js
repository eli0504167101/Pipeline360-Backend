const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const controller = require('../controllers/reservationController');
const { requireAuth } = require('../middleware/auth');
const { requireOrigin, requireCsrf } = require('../middleware/csrf');

function reservationRoutes(config) {
    const router = express.Router();
    router.get('/hotels', controller.getHotels);
    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        if (!config) return res.status(401).json({ error: 'Authentication required' });
        if (req.app.locals.authReady === false || mongoose.connection.readyState !== 1) {
            return res.status(503).json({ error: 'Reservations temporarily unavailable' });
        }
        next();
    });
    if (!config) return router;
    router.use(cookieParser(), requireAuth(config));
    router.use((req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        requireOrigin(config)(req, res, () => requireCsrf(req, res, () => {
            if (!req.is('application/json')) return res.status(415).json({ error: 'JSON content type required' });
            next();
        }));
    });
    router.use(express.json({ limit: '16kb' }));
    router.get('/lookup/:query', controller.lookupReservation);
    router.post('/', controller.createReservation);
    router.delete('/:id', controller.cancelReservation);
    router.use((error, req, res, next) => {
        if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
        if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
        if (error.status === 415) return res.status(415).json({ error: 'Unsupported JSON encoding' });
        res.status(503).json({ error: 'Reservations temporarily unavailable' });
    });
    return router;
}
module.exports = reservationRoutes;
