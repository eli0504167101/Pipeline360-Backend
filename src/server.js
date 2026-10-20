const { loadAuthConfig } = require('./config/auth');
const { startDatabaseLifecycle } = require('./services/databaseLifecycle');
const config = loadAuthConfig();
const dbURI = process.env.MONGO_URL;
if (!dbURI || !/^mongodb(?:\+srv)?:\/\//.test(dbURI)) {
    throw new Error('MONGO_URL must be an explicit MongoDB connection string');
}
const app = require('./app').createApp(config);
app.locals.authReady = false;
const PORT = process.env.PORT || 3000;

// Keep liveness available during database startup/recovery. Never log the URI.
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
startDatabaseLifecycle({ app, uri: dbURI });
