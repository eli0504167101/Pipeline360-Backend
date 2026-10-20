const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    _id: { type: String },
    count: { type: Number, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { bufferCommands: false, versionKey: false, autoCreate: false, autoIndex: false, read: 'primary', writeConcern: { w: 'majority', wtimeout: 5000 } });
module.exports = mongoose.model('AuthRateLimit', schema);
