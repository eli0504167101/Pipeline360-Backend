const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    tokenHash: { type: String, required: true, unique: true, select: false },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true, bufferCommands: false, autoCreate: false, autoIndex: false, read: 'primary', writeConcern: { w: 'majority', wtimeout: 5000 } });
module.exports = mongoose.model('Session', schema);
