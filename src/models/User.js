const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    subscriptionTier: { type: String, enum: ['free', 'premium'], default: 'free', required: true }
}, { timestamps: true, bufferCommands: false, writeConcern: { w: 'majority' } });
module.exports = mongoose.model('User', schema);
