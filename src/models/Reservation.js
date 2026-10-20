const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema(
  {
    reservationId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      immutable: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true
    },
    checkIn: {
      type: Date,
      required: true
    },
    checkOut: {
      type: Date,
      required: true
    },
    hotelId: {
      type: String,
      required: true,
      trim: true
    }
  },
  {
    timestamps: true,
    read: 'primary',
    writeConcern: { w: 'majority', wtimeout: 5000 }
  }
);

module.exports = mongoose.model('Reservation', reservationSchema);