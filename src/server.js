const express = require('express');
const cors = require('cors'); // וודא שהתקנת עם: npm install cors
const app = express();

// זה החלק שחסר לך כנראה!
app.use(cors({
    origin: '*' // מאפשר לכל אתר (כולל פורט 5500) לפנות לשרת
}));

app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running!' });
});

app.listen(8080, '0.0.0.0', () => {
    console.log('Server is running on port 8080');
});