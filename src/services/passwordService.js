const { scrypt, randomBytes, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
let active = false;

async function key(password, salt) {
    // Bound per-replica hashing memory and avoid an unbounded work queue.
    if (active) throw Object.assign(new Error('Authentication busy'), { status: 503 });
    active = true;
    try {
        return await derive(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    } finally { active = false; }
}
async function hashPassword(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = await key(password, Buffer.from(salt, 'hex'));
    return `scrypt$32768$8$1$${salt}$${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
    const match = typeof encoded === 'string' &&
        /^scrypt\$32768\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(encoded);
    // Unknown users still incur the same password derivation cost.
    const actual = await key(password, match ? Buffer.from(match[1], 'hex') : Buffer.alloc(16));
    return Boolean(match) && timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
}
module.exports = { hashPassword, verifyPassword };
