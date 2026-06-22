const express = require('express');
const redis = require('redis');
const app = express();
const client = redis.createClient({ url: 'redis://redis-server:6379' });

client.connect();

app.get('/', async (req, res) => {
    // הבדיקה של התרגיל: קריאה מה-DB והגדלה ב-1
    let visits = await client.get('visits');
    if (visits === null) visits = 0;
    
    const newVisits = parseInt(visits) + 1;
    await client.set('visits', newVisits);
    
    res.send(`מספר המבקרים באתר: ${newVisits}`);
});

app.listen(8080, () => console.log('Backend running on port 8080'));
