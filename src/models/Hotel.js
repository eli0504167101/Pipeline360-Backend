const mongoose = require('mongoose');

const hotelSchema = new mongoose.Schema({
    hotelId: {
        type: String,
        required: true,
        unique: true
    },
    hotelName: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    location: {
        type: String,
        default: ''
    },
    pricePerNight: {
        type: Number,
        required: true
    }
});

module.exports = mongoose.model('Hotel', hotelSchema);