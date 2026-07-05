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
// שנה את הנתיב מ-'/' ל-'/api/visits'
app.get('/api/visits', async (req, res) => {
    let visits = await client.get('visits');
    if (visits === null) visits = 0;
    
    const visits = await client.get('visits');
  res.send(`מספר המבקרים: ${visits || 0}`);
});

app.listen(8080, '0.0.0.0', () => console.log('Backend running on port 8080'));