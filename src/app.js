const express = require('express');
const redis = require('redis');
const cors = require('cors');
const app = express();

app.use(cors()); // מאפשר גישה מכל מקור

const client = redis.createClient({ url: 'redis://redis-server:6379' });
client.connect().then(() => {
    console.log('Successfully connected to Redis!');
}).catch(err => {
    console.error('Redis connection error:', err);
});

// ה-Health check שדרשת
// בתוך ה-app.js
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running!' });
});

// הלוגיקה של התרגיל
app.get('/', async (req, res) => {
    let visits = await client.get('visits');
    if (visits === null) visits = 0;
    
    const newVisits = parseInt(visits) + 1;
    await client.set('visits', newVisits);
    
    res.send(`מספר המבקרים באתר: ${newVisits}`);
});

app.listen(8080, '0.0.0.0', () => console.log('Backend running on port 8080'));