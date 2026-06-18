const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, '../db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
if (db.shops.kaya) {
  db.shops.kaya.totalPaid = 0;
  db.shops.kaya.payments = [];
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  console.log('Successfully reset Kaya shop totalPaid to 0 and cleared payments.');
} else {
  console.log('Kaya shop not found.');
}
