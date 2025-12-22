import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

// 1. Load Credentials
const token = process.env.JIRA_TOKEN || process.env.JIRA_API_TOKEN;
const email = process.env.JIRA_EMAIL;
let domain = process.env.JIRA_DOMAIN;

console.log("\n🏥 --- JIRA CONNECTION DOCTOR ---");

// 2. Check Variables
if (!token) {
    console.error("❌ ERROR: JIRA_TOKEN (or JIRA_API_TOKEN) is missing from .env");
} else {
    console.log(`✅ Token Found (Length: ${token.length} chars). ${token.length < 50 ? "⚠️ WARNING: This looks too short!" : "Looks like a full token."}`);
}

if (!email) {
    console.error("❌ ERROR: JIRA_EMAIL is missing from .env");
} else {
    console.log(`✅ Email Found: ${email}`);
}

if (!domain) {
    console.error("❌ ERROR: JIRA_DOMAIN is missing from .env");
} else {
    // Sanitize Domain
    domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    console.log(`✅ Domain Found: ${domain}`);
}

// 3. Attempt Connection
if (token && email && domain) {
    const url = `https://${domain}/rest/api/3/myself`; // Simple "Who am I" check
    const auth = Buffer.from(`${email}:${token}`).toString('base64');

    console.log(`\n🔄 Attempting to connect to: ${url}...`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
            }
        });

        if (response.status === 200) {
            const data = await response.json();
            console.log(`\n🎉 SUCCESS! Connected as user: ${data.displayName}`);
            console.log("✅ Your credentials are correct. The issue is fixed.");
        } else {
            console.log(`\n❌ FAILED. Status: ${response.status} (${response.statusText})`);
            if (response.status === 401) {
                console.log("💡 HINT: 401 means 'Unauthorized'. Check that:");
                console.log("   1. Your JIRA_EMAIL matches the account that created the token.");
                console.log("   2. You copied the FULL token (not a truncated version).");
            } else if (response.status === 404) {
                console.log("💡 HINT: 404 means 'Not Found'. Your JIRA_DOMAIN is likely wrong.");
            }
        }
    } catch (error) {
        console.error(`\n❌ NETWORK ERROR: ${error.message}`);
    }
}
console.log("----------------------------------\n");