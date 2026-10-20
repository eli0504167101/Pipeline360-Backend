const User = require('../models/User');
const Session = require('../models/Session');
const AuthRateLimit = require('../models/AuthRateLimit');
async function initializeAuthDatabase() {
    // Await unique and TTL indexes before accepting authentication traffic.
    await Promise.all([User.init(), Session.init(), AuthRateLimit.init()]);
}
module.exports = { initializeAuthDatabase };
