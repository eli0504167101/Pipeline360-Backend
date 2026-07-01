FROM node:18-alpine

WORKDIR /app

# מעתיק קודם רק את קבצי ההגדרות כדי לחסוך זמן בבנייה
COPY package*.json ./

# כאן הוא מתקין הכל, כולל cors
RUN npm install

# עכשיו מעתיק את הקוד
COPY . .

CMD ["node", "src/app.js"]