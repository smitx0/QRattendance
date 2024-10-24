const { google } = require('googleapis');
const QRCode = require('qrcode');
const crypto = require('crypto');

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS); // Load credentials from environment variable
const { client_email, private_key } = credentials;

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.JWT(client_email, null, private_key, SCOPES);

const SPREADSHEET_ID = '1n7_JrVIP2XhJS6PBv02PRL7fjScno_txz8kJQEamd4Y';
const SHEET_NAME = 'G3G4_Micro'; 

module.exports = async (req, res) => {
    const token = crypto.randomBytes(16).toString('hex');
    const sessionId = crypto.randomBytes(16).toString('hex');

    const url = `${req.headers.origin}/api/mark-attendance?sessionId=${sessionId}&token=${token}`;

    try {
        const qrCode = await QRCode.toDataURL(url);
        res.status(200).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>QR Code</title>
            </head>
            <body>
                <div style="text-align: center;">
                    <img src="${qrCode}" alt="QR Code">
                    <p>Scan the code to mark attendance.</p>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        res.status(500).send('Error generating QR code');
    }
};
