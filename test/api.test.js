const assert = require('node:assert/strict');
const { beforeEach, afterEach, test, mock } = require('node:test');
const request = require('supertest');
const mongoose = require('mongoose');
const Hotel = require('../src/models/Hotel');
const Reservation = require('../src/models/Reservation');
const Session = require('../src/models/Session');
const User = require('../src/models/User');
const { loadAuthConfig } = require('../src/config/auth');
const { csrfToken } = require('../src/services/sessionService');
const config = loadAuthConfig({ AUTH_ENV: 'local', AUTH_ORIGIN: 'http://hotel.local:3000' });
const ownerId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
const ownership = { userId: ownerId, $expr: { $eq: [{ $type: '$userId' }, 'objectId'] } };
const token = 'a'.repeat(64);
let originalState;
function setDatabaseState(value) {
    Object.defineProperty(mongoose.connection, 'readyState', { configurable: true, get: () => value });
}

// Guard application loading and every test against accidental database connections.
const connectGuard = mock.method(mongoose, 'connect', () => {
    throw new Error('Database connections are forbidden in API tests');
});
const app = require('../src/app').createApp(config);
// Suppress Express's expected malformed-JSON error log in this test process only.
app.set('env', 'test');
assert.equal(connectGuard.mock.callCount(), 0);
mock.restoreAll();

const reservationInput = {
    fullName: 'Test Guest',
    email: 'guest@example.com',
    hotelId: 'HOTEL-1',
    checkIn: '2030-06-01',
    checkOut: '2030-06-03'
};
const storedReservation = { reservationId: 'RES-TEST-1', ...reservationInput, userId: ownerId.toString() };
let databaseMocks;
let connectionMock;

function api(method, path) {
    const result = request(app)[method](path).timeout({ response: 2000, deadline: 5000 })
        .set('Cookie', `${config.cookieName}=${token}`).set('Origin', config.origin)
        .set('X-CSRF-Token', csrfToken(token));
    return method === 'delete' ? result.send({}) : result;
}

beforeEach(() => {
    originalState = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    setDatabaseState(1);
    mock.method(Session, 'findOne', () => ({ lean: async () => ({ userId: ownerId, expiresAt: new Date(Date.now() + 60000) }) }));
    mock.method(User, 'findById', () => ({ lean: async () => ({ _id: ownerId, subscriptionTier: 'free' }) }));
    connectionMock = mock.method(mongoose, 'connect', () => {
        throw new Error('Database connections are forbidden in API tests');
    });
    // Fail immediately rather than buffering a real Mongoose query.
    databaseMocks = [
        [Hotel, 'find'],
        [Hotel, 'findOne'],
        [Reservation, 'findOne'],
        [Reservation, 'findOneAndDelete'],
        [Reservation, 'findByIdAndDelete'],
        [Reservation.prototype, 'save']
    ].map(([target, method]) => mock.method(target, method, async () => {
        throw new Error(`Unexpected database operation: ${method}`);
    }));
    mock.method(console, 'error', () => {});
});

afterEach(() => {
    try {
        assert.equal(connectionMock.mock.callCount(), 0);
    } finally {
        mock.restoreAll();
        if (originalState) Object.defineProperty(mongoose.connection, 'readyState', originalState);
        else delete mongoose.connection.readyState;
    }
    assert.equal(mongoose.connection.readyState, 0);
});

function assertNoDatabaseOperations() {
    for (const method of databaseMocks) {
        assert.equal(method.mock.callCount(), 0);
    }
}

test('GET /health stays healthy without a database connection', async () => {
    setDatabaseState(0);
    await api('get', '/health')
        .expect('Content-Type', /json/)
        .expect(200, { status: 'healthy' });
    assertNoDatabaseOperations();
});

test('GET /ready reports a disconnected database', async () => {
    setDatabaseState(0);
    await api('get', '/ready')
        .expect(503, { status: 'not ready', database: 'disconnected' });
    assertNoDatabaseOperations();
});

test('GET /ready reports a connected database without opening a connection', async () => {
    // Shadow the inherited Mongoose getter without invoking its state-changing setter.
    const original = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
    Object.defineProperty(mongoose.connection, 'readyState', {
        configurable: true,
        get: () => 1
    });
    try {
        await api('get', '/ready')
            .expect(200, { status: 'ready', database: 'connected' });
        assertNoDatabaseOperations();
    } finally {
        if (original) {
            Object.defineProperty(mongoose.connection, 'readyState', original);
        } else {
            delete mongoose.connection.readyState;
        }
    }
});

for (const hotels of [[], [{ hotelId: 'HOTEL-1', hotelName: 'Test Hotel', pricePerNight: 100 }]]) {
    test(`GET /api/reservations/hotels returns ${hotels.length} hotels`, async () => {
        Hotel.find.mock.mockImplementation(async () => hotels);
        await api('get', '/api/reservations/hotels').expect(200, hotels);
        assert.equal(Hotel.find.mock.callCount(), 1);
        assert.deepEqual(Hotel.find.mock.calls[0].arguments, []);
    });
}

test('GET /api/reservations/hotels handles a database failure', async () => {
    Hotel.find.mock.mockImplementation(async () => { throw new Error('Test database failure'); });
    await api('get', '/api/reservations/hotels').expect(500, {
        error: 'Failed to fetch hotels', details: 'Test database failure'
    });
});

test('GET /api/reservations/lookup/:query returns a reservation', async () => {
    Reservation.findOne.mock.mockImplementation(async () => storedReservation);
    await api('get', '/api/reservations/lookup/RES-TEST-1').expect(200, storedReservation);
    assert.deepEqual(Reservation.findOne.mock.calls[0].arguments, [{
        ...ownership,
        $or: [
            { reservationId: 'RES-TEST-1' },
            { fullName: 'RES-TEST-1' },
            { email: 'res-test-1' }
        ]
    }]);
});

test('GET /api/reservations/lookup/:query returns 404 when absent', async () => {
    Reservation.findOne.mock.mockImplementation(async () => null);
    await api('get', '/api/reservations/lookup/missing')
        .expect(404, { message: 'Reservation not found' });
    assert.equal(Reservation.findOne.mock.callCount(), 1);
    assert.deepEqual(Reservation.findOne.mock.calls[0].arguments, [{
        ...ownership,
        $or: [{ reservationId: 'missing' }, { fullName: 'missing' }, { email: 'missing' }]
    }]);
});

test('GET /api/reservations/lookup/:query handles a database failure', async () => {
    Reservation.findOne.mock.mockImplementation(async () => { throw new Error('Test database failure'); });
    await api('get', '/api/reservations/lookup/RES-TEST-1').expect(500, {
        error: 'Lookup reservation failed'
    });
});

for (const field of Object.keys(reservationInput)) {
    test(`POST /api/reservations rejects missing ${field} before querying the database`, async () => {
        const input = { ...reservationInput };
        delete input[field];
        await api('post', '/api/reservations').send(input).expect(400, {
            error: 'Validation failed', details: 'All reservation fields are required'
        });
        assertNoDatabaseOperations();
    });
}

test('POST /api/reservations rejects an invalid email before querying the database', async () => {
    await api('post', '/api/reservations')
        .send({ ...reservationInput, email: 'invalid-email' })
        .expect(400, { error: 'Validation failed', details: 'Email address is invalid' });
    assertNoDatabaseOperations();
});

test('POST /api/reservations accepts a valid email and creates a reservation', async () => {
    Hotel.findOne.mock.mockImplementation(async () => ({ hotelId: 'HOTEL-1' }));
    Reservation.findOne.mock.mockImplementation(async () => null);
    Reservation.prototype.save.mock.mockImplementation(async function () { return this; });
    const response = await api('post', '/api/reservations').send(reservationInput).expect(201);
    assert.equal(response.body.message, 'Reservation created successfully');
    assert.match(response.body.reservationId, /^RES-\d+-[A-Z0-9]+$/);
    assert.equal(response.body.id, response.body.reservationId);
    assert.deepEqual(Hotel.findOne.mock.calls[0].arguments, [{ hotelId: 'HOTEL-1' }]);
    assert.deepEqual(Reservation.findOne.mock.calls[0].arguments, [{
        hotelId: 'HOTEL-1',
        checkIn: { $lt: new Date(reservationInput.checkOut) },
        checkOut: { $gt: new Date(reservationInput.checkIn) }
    }]);
    assert.equal(Reservation.prototype.save.mock.callCount(), 1);
    const saved = Reservation.prototype.save.mock.calls[0].this;
    assert.equal(saved.email, reservationInput.email);
    assert.equal(saved.fullName, reservationInput.fullName);
    assert.equal(saved.reservationId, response.body.reservationId);
    assert.equal(saved.hotelId, reservationInput.hotelId);
    assert.equal(String(saved.userId), String(ownerId));
    assert.deepEqual(saved.checkIn, new Date(reservationInput.checkIn));
    assert.deepEqual(saved.checkOut, new Date(reservationInput.checkOut));
});

test('DELETE /api/reservations/:id cancels an existing reservation', async () => {
    Reservation.findOneAndDelete.mock.mockImplementation(async () => storedReservation);
    await api('delete', '/api/reservations/RES-TEST-1').expect(200, {
        message: 'Reservation cancelled successfully', reservationId: 'RES-TEST-1'
    });
    assert.deepEqual(Reservation.findOneAndDelete.mock.calls[0].arguments, [{ reservationId: 'RES-TEST-1', ...ownership }]);
    assert.equal(Reservation.findByIdAndDelete.mock.callCount(), 0);
});

test('DELETE /api/reservations/:id returns 404 when absent', async () => {
    Reservation.findOneAndDelete.mock.mockImplementation(async () => null);
    await api('delete', '/api/reservations/missing')
        .expect(404, { message: 'Reservation not found' });
    assert.equal(Reservation.findOneAndDelete.mock.callCount(), 1);
    assert.deepEqual(Reservation.findOneAndDelete.mock.calls[0].arguments, [{ reservationId: 'missing', ...ownership }]);
    assert.equal(Reservation.findByIdAndDelete.mock.callCount(), 0);
});

test('DELETE /api/reservations/:id supports legacy MongoDB IDs', async () => {
    const legacyId = '507f1f77bcf86cd799439011';
    Reservation.findOneAndDelete.mock.mockImplementation(async filter => filter._id ? storedReservation : null);
    await api('delete', `/api/reservations/${legacyId}`).expect(200, {
        message: 'Reservation cancelled successfully', reservationId: 'RES-TEST-1'
    });
    assert.deepEqual(Reservation.findOneAndDelete.mock.calls[1].arguments, [{ _id: legacyId, ...ownership }]);
});

for (const field of ['checkIn', 'checkOut']) {
    test(`POST /api/reservations rejects invalid ${field} before querying the database`, async () => {
        await api('post', '/api/reservations')
            .send({ ...reservationInput, [field]: 'not-a-date' })
            .expect(400, {
                error: 'Validation failed',
                details: 'Check-in and check-out dates must be valid'
            });
        assertNoDatabaseOperations();
    });
}

for (const checkOut of ['2030-06-01', '2030-05-31']) {
    test(`POST /api/reservations rejects check-out ${checkOut} at or before check-in`, async () => {
        await api('post', '/api/reservations')
            .send({ ...reservationInput, checkOut })
            .expect(400, {
                error: 'Validation failed',
                details: 'Check-out date must be after check-in date'
            });
        assertNoDatabaseOperations();
    });
}

test('POST /api/reservations returns 404 for a missing hotel without saving', async () => {
    Hotel.findOne.mock.mockImplementation(async () => null);
    await api('post', '/api/reservations').send(reservationInput).expect(404, {
        error: 'Hotel not found', details: "Hotel 'HOTEL-1' does not exist"
    });
    assert.equal(Hotel.findOne.mock.callCount(), 1);
    assert.deepEqual(Hotel.findOne.mock.calls[0].arguments, [{ hotelId: 'HOTEL-1' }]);
    assert.equal(Reservation.findOne.mock.callCount(), 0);
    assert.equal(Reservation.prototype.save.mock.callCount(), 0);
});

test('POST /api/reservations rejects overlapping reservations without saving', async () => {
    Hotel.findOne.mock.mockImplementation(async () => ({ hotelId: 'HOTEL-1' }));
    Reservation.findOne.mock.mockImplementation(async () => storedReservation);
    await api('post', '/api/reservations').send(reservationInput).expect(409, {
        error: 'Dates are unavailable',
        details: 'The selected hotel is already reserved for these dates'
    });
    assert.equal(Hotel.findOne.mock.callCount(), 1);
    assert.deepEqual(Hotel.findOne.mock.calls[0].arguments, [{ hotelId: 'HOTEL-1' }]);
    assert.equal(Reservation.findOne.mock.callCount(), 1);
    assert.deepEqual(Reservation.findOne.mock.calls[0].arguments, [{
        hotelId: 'HOTEL-1',
        checkIn: { $lt: new Date(reservationInput.checkOut) },
        checkOut: { $gt: new Date(reservationInput.checkIn) }
    }]);
    assert.equal(Reservation.prototype.save.mock.callCount(), 0);
});

for (const scenario of [
    {
        name: 'duplicate key', code: 11000, status: 409,
        body: { error: 'Reservation conflict', details: 'A reservation with this ID already exists' }
    },
    {
        name: 'save failure', status: 500,
        body: { error: 'Failed to create reservation' }
    }
]) {
    test(`POST /api/reservations handles ${scenario.name}`, async () => {
        Hotel.findOne.mock.mockImplementation(async () => ({ hotelId: 'HOTEL-1' }));
        Reservation.findOne.mock.mockImplementation(async () => null);
        Reservation.prototype.save.mock.mockImplementation(async () => {
            throw Object.assign(new Error('Test save failure'), { code: scenario.code });
        });
        await api('post', '/api/reservations').send(reservationInput)
            .expect(scenario.status, scenario.body);
        assert.equal(Hotel.findOne.mock.callCount(), 1);
        assert.equal(Reservation.findOne.mock.callCount(), 1);
        assert.equal(Reservation.prototype.save.mock.callCount(), 1);
    });
}

// Preserve validation and reservation behavior under the authenticated ownership contract.
for (const query of [' Test Guest ', ' GUEST@EXAMPLE.COM ']) {
    test(`GET lookup normalizes ${JSON.stringify(query)}`, async () => {
        Reservation.findOne.mock.mockImplementation(async () => storedReservation);
        await api('get', `/api/reservations/lookup/${encodeURIComponent(query)}`)
            .expect(200, storedReservation);
        const normalized = query.trim();
        assert.deepEqual(Reservation.findOne.mock.calls[0].arguments, [{
            ...ownership,
        $or: [
                { reservationId: normalized },
                { fullName: normalized },
                { email: normalized.toLowerCase() }
            ]
        }]);
    });
}

test('GET lookup rejects whitespace without querying the database', async () => {
    await api('get', '/api/reservations/lookup/%20%20')
        .expect(400, { message: 'Search value is required' });
    assertNoDatabaseOperations();
});

test('POST normalizes text fields before querying and saving', async () => {
    Hotel.findOne.mock.mockImplementation(async () => ({ hotelId: 'HOTEL-1' }));
    Reservation.findOne.mock.mockImplementation(async () => null);
    Reservation.prototype.save.mock.mockImplementation(async function () { return this; });
    await api('post', '/api/reservations').send({
        ...reservationInput,
        fullName: '  Test Guest  ',
        email: '  GUEST@EXAMPLE.COM  ',
        hotelId: '  HOTEL-1  '
    }).expect(201);
    assert.deepEqual(Hotel.findOne.mock.calls[0].arguments, [{ hotelId: 'HOTEL-1' }]);
    const saved = Reservation.prototype.save.mock.calls[0].this;
    assert.equal(saved.fullName, reservationInput.fullName);
    assert.equal(saved.email, reservationInput.email);
    assert.equal(saved.hotelId, reservationInput.hotelId);
    assert.equal(String(saved.userId), String(ownerId));
});

for (const [field, value] of [['fullName', '   '], ['email', {}], ['hotelId', 123]]) {
    test(`POST rejects non-text or blank ${field} without database access`, async () => {
        await api('post', '/api/reservations').send({ ...reservationInput, [field]: value })
            .expect(400, {
                error: 'Validation failed', details: 'All reservation fields are required'
            });
        assertNoDatabaseOperations();
    });
}

for (const operation of ['hotel lookup', 'availability lookup']) {
    test(`POST handles database failure during ${operation} without saving`, async () => {
        Hotel.findOne.mock.mockImplementation(async () => {
            if (operation === 'hotel lookup') throw new Error('Test lookup failure');
            return { hotelId: 'HOTEL-1' };
        });
        Reservation.findOne.mock.mockImplementation(async () => {
            throw new Error('Test lookup failure');
        });
        await api('post', '/api/reservations').send(reservationInput).expect(500, {
            error: 'Failed to create reservation'
        });
        assert.equal(Reservation.prototype.save.mock.callCount(), 0);
        assert.equal(Reservation.findOne.mock.callCount(), operation === 'hotel lookup' ? 0 : 1);
    });
}

test('DELETE rejects a whitespace ID without querying the database', async () => {
    await api('delete', '/api/reservations/%20%20')
        .expect(400, { message: 'Reservation ID is required' });
    assertNoDatabaseOperations();
});

test('DELETE returns 404 when both reservation ID and legacy ID are absent', async () => {
    const id = '507f1f77bcf86cd799439011';
    Reservation.findOneAndDelete.mock.mockImplementation(async () => null);
    Reservation.findByIdAndDelete.mock.mockImplementation(async () => null);
    await api('delete', `/api/reservations/${id}`)
        .expect(404, { message: 'Reservation not found' });
    assert.deepEqual(Reservation.findOneAndDelete.mock.calls[0].arguments, [{ reservationId: id, ...ownership }]);
    assert.deepEqual(Reservation.findOneAndDelete.mock.calls[1].arguments, [{ _id: id, ...ownership }]);
});

for (const legacy of [false, true]) {
    test(`DELETE handles database failure in ${legacy ? 'legacy' : 'reservation ID'} lookup`, async () => {
        Reservation.findOneAndDelete.mock.mockImplementation(async filter => {
            if (!legacy || filter._id) throw new Error('Test cancellation failure');
            return null;
        });
        await api('delete', '/api/reservations/507f1f77bcf86cd799439011').expect(500, {
            message: 'Server Error'
        });
        assert.equal(Reservation.findOneAndDelete.mock.callCount(), legacy ? 2 : 1);
        assert.equal(Reservation.findByIdAndDelete.mock.callCount(), 0);
    });
}

test('DELETE prefers a reservation ID match even when it looks like a MongoDB ID', async () => {
    const id = '507f1f77bcf86cd799439011';
    Reservation.findOneAndDelete.mock.mockImplementation(async () => ({ reservationId: id }));
    await api('delete', `/api/reservations/${id}`).expect(200, {
        message: 'Reservation cancelled successfully', reservationId: id
    });
    assert.equal(Reservation.findByIdAndDelete.mock.callCount(), 0);
});

test('POST rejects malformed JSON before querying the database', async () => {
    await api('post', '/api/reservations')
        .set('Content-Type', 'application/json').send('{broken').expect(400);
    assertNoDatabaseOperations();
});
