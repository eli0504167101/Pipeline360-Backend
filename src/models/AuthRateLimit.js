const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    _id: { type: String },
    count: { type: Number, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { bufferCommands: false, versionKey: false, writeConcern: { w: 'majority' } });
module.exports = mongoose.model('AuthRateLimit', schema);
