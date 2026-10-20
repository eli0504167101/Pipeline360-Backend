const User = require('../models/User');
const Session = require('../models/Session');
const AuthRateLimit = require('../models/AuthRateLimit');
async function initializeAuthDatabase() {
    // Explicit DDL can be retried; Model.init() caches a rejected promise.
    const options = { maxTimeMS: 10000, writeConcern: { w: 'majority', wtimeoutMS: 5000 } };
    const results = await Promise.allSettled([User, Session, AuthRateLimit].map(async model => {
        await model.createCollection(options);
        // Driver 7 createIndexes() strips maxTimeMS; createIndex() preserves it.
        for (const [key, indexOptions] of model.schema.indexes()) {
            await model.collection.createIndex(key, { ...indexOptions, ...options });
        }
    }));
    // Wait for every in-flight build before retrying the initialization batch.
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
}
module.exports = { initializeAuthDatabase };
