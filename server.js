const { google } = require('googleapis');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const crypto = require('crypto');

require('dotenv').config(); 

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Load the Google Sheets API credentials
const credentials = JSON.parse(fs.readFileSync('credentials.json'));
const { client_email, private_key } = credentials;

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.JWT(client_email, null, private_key, SCOPES);

// Replace with your Google Sheet ID and range
const SPREADSHEET_ID = '1n7_JrVIP2XhJS6PBv02PRL7fjScno_txz8kJQEamd4Y';
const SHEET_NAME = 'G3G4_Micro'; 

// Function to log attendance
async function logAttendance(rollNo, className, res) {
  const sheets = google.sheets({ version: 'v4', auth });

  try {
    const getRows = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:ZZ`,
    });

    const rows = getRows.data.values;
    if (!rows.length) {
      res.send('No data found in the sheet.');
      return;
    }

    // Step 2: Find the row corresponding to the Roll No
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][1] === rollNo) { // Roll No is in column B (index 1)
        rowIndex = i;
        break;
      }
    }

    // Validation: Roll number not found
    if (rowIndex === -1) {
      res.send(`Error: Roll No ${rollNo} not found in the attendance list.`);
      return;
    }

    // Step 3: Get today's date in the correct format
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0'); // Ensure two digits
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are zero-indexed, add 1
    const year = String(today.getFullYear()).slice(-2); // Get last two digits of the year
    const formattedDate = `${day}/${month}/${year}`; // Combine to DD/MM/YY format

    // Step 4: Find all column indexes for today's date
    const START_COLUMN_INDEX = 7; // Starting from 'G' column
    const columnIndexes = [];

    for (let colIndex = START_COLUMN_INDEX; colIndex < rows[5].length; colIndex++) {
      const columnHeader = rows[5][colIndex];
      if (columnHeader === formattedDate) {
        columnIndexes.push(colIndex);
      }
    }

    if (columnIndexes.length > 0) {
      // Iterate through all matching columns and update attendance
      const updates = columnIndexes.map(columnIndex => {
        const columnLetter = getColumnLetter(columnIndex);
        const rangeToUpdate = `${SHEET_NAME}!${columnLetter}${rowIndex + 1}`;
        return sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: rangeToUpdate,
          valueInputOption: 'RAW',
          resource: {
            values: [[1]], // Mark presence with '1'
          },
        });
      });

      await Promise.all(updates); // Wait for all updates to complete

      res.send(`Attendance marked for Roll No ${rollNo} for : ${formattedDate}.`);
    } else {
      res.send("Error: Today's date column not found.");
    }
  } catch (error) {
    console.error('Error logging attendance:', error);
    res.send('Error logging attendance.');
  }
}

// Function to get column letter
function getColumnLetter(columnIndex) {
  let letter = '';
  columnIndex += 1; // Convert from zero-based to one-based index

  while (columnIndex > 0) {
    let currentLetter = (columnIndex - 1) % 26;
    letter = String.fromCharCode(65 + currentLetter) + letter;
    columnIndex = Math.floor((columnIndex - 1) / 26);
  }

  return letter;
}

// Route to generate and serve QR code

// Route to serve the attendance form
const VALID_TOKENS = new Set(); // Store valid tokens for validation
const sessions = new Map(); // Store session tokens

// Generate and serve the QR code
app.get('/', (req, res) => {
  const token = crypto.randomBytes(16).toString('hex'); // Generate a unique token
  const sessionId = crypto.randomBytes(16).toString('hex'); // Generate a unique session ID

  // Store the token in the valid tokens set
  VALID_TOKENS.add(token);

  // Store the session data
  sessions.set(sessionId, {
    token: token,
    used: false,
    timestamp: Date.now(),
  });

  const url = `${req.protocol}://${req.get('host')}/mark-attendance?sessionId=${sessionId}&token=${token}`; // Include the token in the URL

  QRCode.toDataURL(url, (err, qrCode) => {
    if (err) {
      res.send('Error generating QR code');
      return;
    }

 // Center the QR code
 const centeredHtml = `
 <!DOCTYPE html>
 <html lang="en">
 <head>
     <meta charset="UTF-8">
     <meta name="viewport" content="width=device-width, initial-scale=1.0">
     <title>QR Code</title>
     <style>
         body {
             font-family: Arial, sans-serif;
             display: flex;
             justify-content: center;
             align-items: center;
             height: 100vh; /* Full height to center vertically */
             margin: 0;
         }
         .qr-container {
             text-align: center; /* Center text below QR code */
         }
     </style>
 </head>
 <body>
     <div class="qr-container">
         <img src="${qrCode}" alt="QR Code">
         <p>Scan the code to mark attendance.</p>
     </div>
 </body>
 </html>
`;

res.send(centeredHtml);
});
});
// Validate the token and session when marking attendance
app.get('/mark-attendance', (req, res) => {
  const { sessionId, token } = req.query; // Get both sessionId and token from query parameters
  console.log('Session ID from query:', sessionId);
  console.log('Token from query:', token);
  
 // Check if the token exists in the valid token set
 if (!VALID_TOKENS.has(token)) {
  res.status(403).send('Access denied: Invalid or missing QR token.');
  return;
}

// Retrieve session data
const sessionData = sessions.get(sessionId);

// Validate the session and token
if (!sessionData) {
  res.status(403).send('Access denied: Session ID not found.');
  return;
}

if (sessionData.token !== token) {
  res.status(403).send('Access denied: Token does not match session.');
  return;
}

// Check if the session has already been used
if (sessionData.used) {
  res.status(403).send('Access denied: This session has already been used.');
  return;
}

// Read the HTML file and inject the token and session ID
fs.readFile(path.join(__dirname, 'attendance.html'), 'utf8', (err, data) => {
  if (err) {
    res.status(500).send('Error reading the attendance form.');
    return;
  }

  // Replace placeholders with actual token and session ID
  const formHtml = data
    .replace('{{token}}', token)
    .replace('{{sessionId}}', sessionId);
  res.send(formHtml);
});
});

const TIME_LIMIT = 60 * 1000; // 60 seconds

// Validate the token and session when marking attendance
app.get('/mark-attendance', (req, res) => {
  const { sessionId, token } = req.query; // Get both sessionId and token from query parameters
  console.log('Session ID from query:', sessionId);
  console.log('Token from query:', token);

  // Check if the token exists in the valid token set
  if (!VALID_TOKENS.has(token)) {
    res.status(403).send('Access denied: Invalid or missing QR token.');
    return;
  }

  // Retrieve session data
  const sessionData = sessions.get(sessionId);

  // Validate the session and token
  if (!sessionData) {
    res.status(403).send('Access denied: Session ID not found.');
    return;
  }

  if (sessionData.token !== token) {
    res.status(403).send('Access denied: Token does not match session.');
    return;
  }

  // Check if the session has already been used
  if (sessionData.used) {
    res.status(403).send('Access denied: This session has already been used.');
    return;
  }

  // Check if the session is expired
  const currentTime = Date.now();
  if (currentTime - sessionData.timestamp > TIME_LIMIT) {
    res.status(403).send('Access denied: This QR code has expired.');
    return;
  }

  // If everything is valid, serve the attendance form
  fs.readFile(path.join(__dirname, 'attendance.html'), 'utf8', (err, data) => {
    if (err) {
      res.status(500).send('Error reading the attendance form.');
      return;
    }

    // Replace placeholders with actual token and session ID
    const formHtml = data
      .replace('{{token}}', token)
      .replace('{{sessionId}}', sessionId);
    res.send(formHtml);
  });
});

// Handle form submission for marking attendance
app.post('/mark-attendance', (req, res) => {
  const { rollNo, className, token, sessionId } = req.body;

  console.log('Session ID from form:', sessionId);
  console.log('Token from form:', token);

  // Retrieve session data
  const sessionData = sessions.get(sessionId);

  // Validate the session and token
  if (!sessionData) {
    res.status(403).send('Access denied: Session ID not found.');
    return;
  }

  if (sessionData.token !== token || sessionData.used) {
    res.status(403).send('Access denied: Invalid or already used session token.');
    return;
  }

  // Check if the session is expired
  const currentTime = Date.now();
  if (currentTime - sessionData.timestamp > TIME_LIMIT) {
    res.status(403).send('Access denied: This QR code has expired.');
    return;
  }

  // Proceed with marking attendance
  logAttendance(rollNo, className, res).then(() => {
    // Mark the session as used
    sessionData.used = true;
    console.log('Session marked as used.');
  });
});
// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
