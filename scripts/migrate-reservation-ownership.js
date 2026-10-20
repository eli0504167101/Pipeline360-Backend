const mongoose = require('mongoose');
const { migrateReservationOwnership } = require('../src/services/reservationMigration');

async function main() {
    const args = process.argv.slice(2);
    let apply = false, modeSeen = false, confirmation;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (['--dry-run', '--apply'].includes(arg) && !modeSeen) {
            modeSeen = true;
            apply = arg === '--apply';
        } else if (arg === '--confirm-database' && confirmation === undefined && args[index + 1] && !args[index + 1].startsWith('--')) {
            confirmation = args[++index];
        } else throw new Error('Invalid migration arguments');
    }
    const uri = process.env.MONGO_URL;
    const match = typeof uri === 'string' && /^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)(?:\?.*)?$/.exec(uri);
    if (!match) throw new Error('MONGO_URL must specify an explicit database name');
    const databaseName = decodeURIComponent(match[1]);
    if ((apply && confirmation !== databaseName) || (!apply && confirmation !== undefined)) {
        throw new Error('Apply requires matching --confirm-database; dry-run must not use confirmation');
    }
    // Background connection errors must not produce an uncaught stack/URI dump.
    const onConnectionError = () => {};
    mongoose.connection.on('error', onConnectionError);
    try {
        // No application/model imports: a dry-run must never create collections/indexes.
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 35000 });
        if (mongoose.connection.db.databaseName !== databaseName) throw new Error('Unexpected database selection');
        console.log(JSON.stringify(await migrateReservationOwnership(mongoose.connection.db, { apply }), null, 2));
    } finally {
        await mongoose.disconnect();
        mongoose.connection.off('error', onConnectionError);
    }
}
if (require.main === module) {
    main().catch(() => {
        console.error('Reservation ownership migration failed; verify configuration and database state before retrying');
        process.exitCode = 1;
    });
}
module.exports = { main };
