const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    tokenHash: { type: String, required: true, unique: true, select: false },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true, bufferCommands: false, writeConcern: { w: 'majority' } });
module.exports = mongoose.model('Session', schema);
