import { google } from 'googleapis';
import './envConfig.js';

// ---------------------------------------------------------------------------
// Lazy-initialized OAuth2 client for Gmail.
// Credentials are read from process.env at call-time so that tokens injected
// by oauthService.js (after the user clicks "Connect → Google") are picked up
// without restarting the app.
// ---------------------------------------------------------------------------
let _oauth2Client = null;
let _gmail = null;

function getGmailClient() {
    const clientId     = (process.env.GOOGLE_CLIENT_ID     || '').trim();
    const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
    const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || '').trim();

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(
            'Gmail is not connected. Please click "Connect" next to Google in Settings, or set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in your .env file.'
        );
    }

    // Rebuild the client whenever the refresh token changes (e.g. after OAuth)
    if (!_oauth2Client || _oauth2Client._refreshToken !== refreshToken) {
        _oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        _oauth2Client.setCredentials({ refresh_token: refreshToken });
        _oauth2Client._refreshToken = refreshToken;
        _gmail = google.gmail({ version: 'v1', auth: _oauth2Client });
    }

    return _gmail;
}

// ---------------------------------------------------------------------------
// Helper: Build an RFC 2822 email and base64url-encode it for the Gmail API.
// ---------------------------------------------------------------------------
function buildRawEmail({ to, subject, body, cc, bcc }) {
    const lines = [
        `To: ${to}`,
        ...(cc  ? [`Cc: ${cc}`]  : []),
        ...(bcc ? [`Bcc: ${bcc}`] : []),
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        `Subject: ${subject}`,
        '',
        body,
    ];
    const raw = lines.join('\r\n');
    return Buffer.from(raw).toString('base64url');
}

// ---------------------------------------------------------------------------
// Helper: Extract name and email from a header value like "John Doe <john@ex.com>"
// ---------------------------------------------------------------------------
function parseEmailHeader(value) {
    if (!value) return null;
    const match = value.match(/^(.*?)\s*<(.+?)>$/);
    if (match) {
        return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
    }
    // Bare email address
    return { name: '', email: value.trim() };
}

// ==========================================================================
// TOOL 1: SEND GMAIL
// ==========================================================================
export async function sendGmail(input) {
    console.log("📧 Gmail Send Invoked:", JSON.stringify(input));
    const { to, subject, body, cc, bcc } = input;

    if (!to || !subject || !body) {
        throw new Error("Missing required fields: 'to', 'subject', and 'body' are all mandatory.");
    }

    try {
        const gmail = getGmailClient();
        const raw = buildRawEmail({ to, subject, body, cc, bcc });

        const response = await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw },
        });

        return JSON.stringify({
            success: true,
            messageId: response.data.id,
            threadId: response.data.threadId,
            to,
            subject,
            message: `Email sent successfully to ${to}.`,
        });
    } catch (error) {
        console.error("Gmail Send Error:", error);
        const hint = error.message?.includes('not been used in project') || error.message?.includes('is disabled')
            ? ' The Gmail API may not be enabled in the Google Cloud Console. Visit https://console.cloud.google.com/apis/library/gmail.googleapis.com to enable it.'
            : error.message?.includes('insufficient authentication scopes')
            ? ' The Google OAuth token may be missing the gmail.send scope. Disconnect and reconnect Google in Settings.'
            : '';
        return JSON.stringify({
            success: false,
            error: error.message,
            message: `Failed to send email: ${error.message}${hint}`,
        });
    }
}

// ==========================================================================
// TOOL 2: SEARCH GMAIL CONTACTS (resolves a name → email address)
// ==========================================================================
export async function searchGmailContacts(input) {
    console.log("📧 Gmail Contact Search Invoked:", JSON.stringify(input));
    const { query } = input;

    if (!query) {
        throw new Error("Missing required field: 'query' (name or partial email to search for).");
    }

    try {
        const gmail = getGmailClient();

        // Search sent and received emails that mention the query in From/To headers
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: query,
            maxResults: 20,
        });

        const messages = response.data.messages || [];
        if (messages.length === 0) {
            return JSON.stringify({
                success: true,
                contacts: [],
                message: `No emails found matching "${query}". Try a different name or email address.`,
            });
        }

        // Fetch headers from each message to extract email addresses
        const contactMap = new Map();
        const queryLower = query.toLowerCase();

        for (const msg of messages) {
            const detail = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id,
                format: 'metadata',
                metadataHeaders: ['From', 'To', 'Cc'],
            });

            const headers = detail.data.payload?.headers || [];
            for (const h of headers) {
                if (['From', 'To', 'Cc'].includes(h.name)) {
                    // A single header may have multiple comma-separated addresses
                    const parts = h.value.split(',');
                    for (const part of parts) {
                        const parsed = parseEmailHeader(part.trim());
                        if (!parsed) continue;
                        const nameLower  = parsed.name.toLowerCase();
                        const emailLower = parsed.email.toLowerCase();
                        if (nameLower.includes(queryLower) || emailLower.includes(queryLower)) {
                            // Deduplicate by email, keep the version with the longest name
                            const existing = contactMap.get(emailLower);
                            if (!existing || parsed.name.length > existing.name.length) {
                                contactMap.set(emailLower, parsed);
                            }
                        }
                    }
                }
            }
        }

        const contacts = Array.from(contactMap.values());

        return JSON.stringify({
            success: true,
            contacts,
            message: contacts.length
                ? `Found ${contacts.length} contact(s) matching "${query}".`
                : `No contacts matching "${query}" found in email headers. Try a different name.`,
        });
    } catch (error) {
        console.error("Gmail Contact Search Error:", error);
        const hint = error.message?.includes('not been used in project') || error.message?.includes('is disabled')
            ? ' The Gmail API may not be enabled in the Google Cloud Console. Visit https://console.cloud.google.com/apis/library/gmail.googleapis.com to enable it.'
            : error.message?.includes('insufficient authentication scopes')
            ? ' The Google OAuth token may be missing Gmail scopes. Disconnect and reconnect Google in Settings.'
            : '';
        return JSON.stringify({
            success: false,
            error: error.message,
            message: `Failed to search contacts: ${error.message}${hint}`,
        });
    }
}

// ==========================================================================
// TOOL 3: GET RECENT EMAILS
// ==========================================================================
export async function getRecentEmails(input) {
    console.log("📧 Gmail Get Recent Emails Invoked:", JSON.stringify(input));
    const { maxResults = 10, query } = input;

    try {
        const gmail = getGmailClient();

        const listParams = {
            userId: 'me',
            maxResults: Math.min(maxResults, 50),   // cap to avoid excessive API calls
        };
        if (query) listParams.q = query;

        const response = await gmail.users.messages.list(listParams);
        const messages = response.data.messages || [];

        if (messages.length === 0) {
            return JSON.stringify({
                success: true,
                emails: [],
                message: query
                    ? `No emails found matching "${query}".`
                    : 'Your inbox is empty.',
            });
        }

        const emails = [];
        for (const msg of messages) {
            const detail = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id,
                format: 'metadata',
                metadataHeaders: ['From', 'To', 'Subject', 'Date'],
            });

            const headers = detail.data.payload?.headers || [];
            const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

            emails.push({
                id: msg.id,
                threadId: detail.data.threadId,
                from: getHeader('From'),
                to: getHeader('To'),
                subject: getHeader('Subject'),
                date: getHeader('Date'),
                snippet: detail.data.snippet || '',
            });
        }

        return JSON.stringify({
            success: true,
            emails,
            message: `Found ${emails.length} email(s).`,
        });
    } catch (error) {
        console.error("Gmail Get Emails Error:", error);
        const hint = error.message?.includes('not been used in project') || error.message?.includes('is disabled')
            ? ' The Gmail API may not be enabled in the Google Cloud Console. Visit https://console.cloud.google.com/apis/library/gmail.googleapis.com to enable it.'
            : error.message?.includes('insufficient authentication scopes')
            ? ' The Google OAuth token may be missing Gmail scopes. Disconnect and reconnect Google in Settings.'
            : '';
        return JSON.stringify({
            success: false,
            error: error.message,
            message: `Failed to fetch emails: ${error.message}${hint}`,
        });
    }
}
