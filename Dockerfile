FROM node:20-alpine

WORKDIR /app

# מעתיק קודם רק את קבצי ההגדרות כדי לחסוך זמן בבנייה
COPY package*.json ./

# כאן הוא מתקין הכל, כולל cors
RUN npm install

# עכשיו מעתיק את הקוד
COPY . .

EXPOSE 3000

CMD ["node", "src/server.js"]