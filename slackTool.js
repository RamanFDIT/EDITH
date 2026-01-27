import fetch from 'node-fetch';
import './envConfig.js';

// =============================================================================
// SLACK PROTOCOL - Write-Only Announcement System
// =============================================================================
// E.D.I.T.H. uses this tool to broadcast messages to team channels.
// It does not listen; it only speaks.
// =============================================================================

const SLACK_BOT_TOKEN = (process.env.SLACK_BOT_TOKEN || '').trim();
const SLACK_DEFAULT_CHANNEL = (process.env.SLACK_DEFAULT_CHANNEL || '').trim();

/**
 * Validates that Slack credentials are configured
 */
function validateCredentials() {
    if (!SLACK_BOT_TOKEN) {
        throw new Error("SLACK_BOT_TOKEN not configured. Add it to your .env file.");
    }
}

/**
 * Get authorization headers for Slack API
 */
const getAuthHeader = () => ({
    'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
    'Content-Type': 'application/json; charset=utf-8'
});

// =============================================================================
// TOOL 1: SEND MESSAGE TO CHANNEL
// =============================================================================
/**
 * Posts a message to a Slack channel.
 * @param {Object} input - The input parameters
 * @param {string} input.channel - Channel name (with or without #) or channel ID
 * @param {string} input.message - The message text to send
 * @returns {Promise<string>} - Result of the operation
 */
export async function sendSlackMessage(input) {
    console.log("📢 Slack Message Invoked:", JSON.stringify(input));
    
    validateCredentials();
    
    let { channel, message } = input;
    
    if (!message) {
        throw new Error("Message content is required.");
    }
    
    // Use default channel if none specified
    if (!channel) {
        if (!SLACK_DEFAULT_CHANNEL) {
            throw new Error("No channel specified and SLACK_DEFAULT_CHANNEL not configured.");
        }
        channel = SLACK_DEFAULT_CHANNEL;
    }
    
    // Normalize channel name (remove # if present, Slack API expects just the name or ID)
    channel = channel.replace(/^#/, '');
    
    const url = 'https://slack.com/api/chat.postMessage';
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({
                channel: channel,
                text: message,
                // Enable markdown parsing
                mrkdwn: true
            })
        });
        
        const data = await response.json();
        
        if (!data.ok) {
            throw new Error(`Slack API Error: ${data.error}`);
        }
        
        return JSON.stringify({
            success: true,
            channel: data.channel,
            timestamp: data.ts,
            message: `Message delivered to #${channel}`
        });
        
    } catch (error) {
        return JSON.stringify({
            success: false,
            error: `Failed to send Slack message: ${error.message}`
        });
    }
}

// =============================================================================
// TOOL 2: SEND FORMATTED ANNOUNCEMENT
// =============================================================================
/**
 * Posts a formatted announcement with optional sections using Slack Block Kit.
 * Ideal for structured updates, deployment notices, or status reports.
 * @param {Object} input - The input parameters
 * @param {string} input.channel - Channel name or ID
 * @param {string} input.title - Announcement headline
 * @param {string} input.body - Main content of the announcement
 * @param {string} [input.footer] - Optional footer text
 * @param {string} [input.type] - Type of announcement: 'info', 'success', 'warning', 'error'
 * @returns {Promise<string>} - Result of the operation
 */
export async function sendSlackAnnouncement(input) {
    console.log("📣 Slack Announcement Invoked:", JSON.stringify(input));
    
    validateCredentials();
    
    let { channel, title, body, footer, type } = input;
    
    if (!title || !body) {
        throw new Error("Both 'title' and 'body' are required for announcements.");
    }
    
    // Use default channel if none specified
    if (!channel) {
        if (!SLACK_DEFAULT_CHANNEL) {
            throw new Error("No channel specified and SLACK_DEFAULT_CHANNEL not configured.");
        }
        channel = SLACK_DEFAULT_CHANNEL;
    }
    
    channel = channel.replace(/^#/, '');
    
    // Emoji based on announcement type
    const typeEmoji = {
        'info': 'ℹ️',
        'success': '✅',
        'warning': '⚠️',
        'error': '🚨'
    };
    
    const emoji = typeEmoji[type] || '📢';
    
    // Build Slack Block Kit message
    const blocks = [
        {
            type: "header",
            text: {
                type: "plain_text",
                text: `${emoji} ${title}`,
                emoji: true
            }
        },
        {
            type: "section",
            text: {
                type: "mrkdwn",
                text: body
            }
        }
    ];
    
    // Add divider and footer if provided
    if (footer) {
        blocks.push({ type: "divider" });
        blocks.push({
            type: "context",
            elements: [
                {
                    type: "mrkdwn",
                    text: footer
                }
            ]
        });
    }
    
    const url = 'https://slack.com/api/chat.postMessage';
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({
                channel: channel,
                text: `${emoji} ${title}`, // Fallback for notifications
                blocks: blocks
            })
        });
        
        const data = await response.json();
        
        if (!data.ok) {
            throw new Error(`Slack API Error: ${data.error}`);
        }
        
        return JSON.stringify({
            success: true,
            channel: data.channel,
            timestamp: data.ts,
            message: `Announcement delivered to #${channel}`
        });
        
    } catch (error) {
        return JSON.stringify({
            success: false,
            error: `Failed to send announcement: ${error.message}`
        });
    }
}

// =============================================================================
// TOOL 3: POST LINK WITH CONTEXT
// =============================================================================
/**
 * Posts a message with an unfurled link preview. 
 * Perfect for sharing Jira tickets, GitHub PRs, or documentation.
 * @param {Object} input - The input parameters
 * @param {string} input.channel - Channel name or ID
 * @param {string} input.url - The URL to share
 * @param {string} input.context - Contextual message to accompany the link
 * @returns {Promise<string>} - Result of the operation
 */
export async function sendSlackLink(input) {
    console.log("🔗 Slack Link Share Invoked:", JSON.stringify(input));
    
    validateCredentials();
    
    let { channel, url: linkUrl, context } = input;
    
    if (!linkUrl) {
        throw new Error("URL is required.");
    }
    
    // Use default channel if none specified
    if (!channel) {
        if (!SLACK_DEFAULT_CHANNEL) {
            throw new Error("No channel specified and SLACK_DEFAULT_CHANNEL not configured.");
        }
        channel = SLACK_DEFAULT_CHANNEL;
    }
    
    channel = channel.replace(/^#/, '');
    
    // Compose message with context and link
    const message = context 
        ? `${context}\n<${linkUrl}>`
        : `<${linkUrl}>`;
    
    const apiUrl = 'https://slack.com/api/chat.postMessage';
    
    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({
                channel: channel,
                text: message,
                unfurl_links: true,
                unfurl_media: true
            })
        });
        
        const data = await response.json();
        
        if (!data.ok) {
            throw new Error(`Slack API Error: ${data.error}`);
        }
        
        return JSON.stringify({
            success: true,
            channel: data.channel,
            timestamp: data.ts,
            message: `Link shared in #${channel}`
        });
        
    } catch (error) {
        return JSON.stringify({
            success: false,
            error: `Failed to share link: ${error.message}`
        });
    }
}
