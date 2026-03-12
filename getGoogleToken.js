/**
 * One-time script to get Google OAuth2 Refresh Token
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to https://console.cloud.google.com/
 * 2. Create a new project (or select existing)
 * 3. Enable the Google Calendar API and Gmail API
 * 4. Go to "Credentials" -> "Create Credentials" -> "OAuth client ID"
 * 5. Choose "Desktop app" as application type
 * 6. Download the JSON and copy CLIENT_ID and CLIENT_SECRET
 * 7. Add to your .env file:
 *    GOOGLE_CLIENT_ID=your_client_id
 *    GOOGLE_CLIENT_SECRET=your_client_secret
 * 8. Run: node getGoogleToken.js
 * 9. A browser will open - grant permission
 * 10. Copy the GOOGLE_REFRESH_TOKEN to your .env file
 */

import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';
import open from 'open';
import dotenv from 'dotenv';
import path from 'path';
import os from 'os';

// Load environment variables
dotenv.config();
dotenv.config({ path: path.join(os.homedir(), '.edith.env') });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

// Scopes for Google Calendar + Gmail
const SCOPES = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.compose',
];

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ ERROR: Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env file');
    console.log('\n📋 Setup Instructions:');
    console.log('1. Go to https://console.cloud.google.com/');
    console.log('2. Create a project and enable Google Calendar API and Gmail API');
    console.log('3. Create OAuth2 credentials (Desktop app)');
    console.log('4. Add to .env:');
    console.log('   GOOGLE_CLIENT_ID=your_client_id');
    console.log('   GOOGLE_CLIENT_SECRET=your_client_secret');
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

async function getRefreshToken() {
    return new Promise((resolve, reject) => {
        // Create a temporary server to catch the OAuth callback
        const server = http.createServer(async (req, res) => {
            try {
                const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
                
                if (url.pathname === '/oauth2callback') {
                    const code = url.searchParams.get('code');
                    
                    if (code) {
                        // Exchange code for tokens
                        const { tokens } = await oauth2Client.getToken(code);
                        
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(`
                            <html>
                                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                                    <h1>✅ Authorization Successful!</h1>
                                    <p>You can close this window and check your terminal.</p>
                                </body>
                            </html>
                        `);
                        
                        server.close();
                        resolve(tokens);
                    } else {
                        const error = url.searchParams.get('error');
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end(`<h1>Error: ${error}</h1>`);
                        server.close();
                        reject(new Error(error));
                    }
                }
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end(`<h1>Error: ${err.message}</h1>`);
                server.close();
                reject(err);
            }
        });

        server.listen(REDIRECT_PORT, async () => {
            console.log(`\n🌐 Temporary server listening on port ${REDIRECT_PORT}...`);
            
            // Generate auth URL
            const authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: SCOPES,
                prompt: 'consent' // Force consent to get refresh token
            });
            
            console.log('\n🔗 Opening browser for authorization...');
            console.log('If browser does not open, visit this URL manually:\n');
            console.log(authUrl);
            
            // Try to open browser automatically
            try {
                await open(authUrl);
            } catch (e) {
                console.log('\n⚠️  Could not open browser automatically. Please open the URL above manually.');
            }
        });
    });
}

async function main() {
    console.log('🔐 Google Calendar OAuth2 Token Generator');
    console.log('==========================================\n');
    
    try {
        const tokens = await getRefreshToken();
        
        console.log('\n✅ SUCCESS! Add this to your .env file:\n');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log('═══════════════════════════════════════════════════════════════');
        
        if (tokens.access_token) {
            console.log('\n📝 Access Token (temporary, auto-refreshes):');
            console.log(tokens.access_token.substring(0, 50) + '...');
        }
        
        console.log('\n🎉 Setup complete! You can now use calendarTool.js');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
    }
    
    process.exit(0);
}

main();
