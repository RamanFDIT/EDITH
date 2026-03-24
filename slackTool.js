import fetch from 'node-fetch';
import './envConfig.js';
import { getValidToken } from './oauthService.js';

// =============================================================================
// SLACK PROTOCOL - Write-Only Announcement System
// =============================================================================
// E.D.I.T.H. uses this tool to broadcast messages to team channels.
// It does not listen; it only speaks.
// =============================================================================

// ---------------------------------------------------------------------------
// Per-user credential helpers.
// Uses getValidToken(userId, 'slack') for the access token.
// ---------------------------------------------------------------------------

async function getSlackToken(userId) {
    const token = await getValidToken(userId, 'slack');
    if (!token) {
        throw new Error(
            'Slack is not connected. Please click "Connect" next to Slack in Settings.'
        );
    }
    return token;
}

function getDefaultChannel() {
    return (process.env.SLACK_DEFAULT_CHANNEL || '').trim();
}

/**
 * Get authorization headers for Slack API
 */
function getAuthHeader(token) {
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8'
    };
}

// =============================================================================
// CHANNEL RESOLUTION & AUTO-JOIN HELPERS
// =============================================================================

/**
 * Authorization-only header for GET requests (no Content-Type needed).
 */
function getAuthOnlyHeader(token) {
    return {
        'Authorization': `Bearer ${token}`,
    };
}

/**
 * Lists ALL channels visible to the bot (public + private it's been invited to).
 * Returns { channels: Map, failed: boolean, failReason: string|null }.
 * Results are cached for 60 seconds to avoid hammering the API.
 */
let _channelCache = null;
let _channelCacheTime = 0;
let _channelListFailed = false;
let _channelListFailReason = null;
const CHANNEL_CACHE_TTL = 60_000; // 60 seconds

async function listAllChannels(token) {
    // Return cached result if fresh
    if (_channelCache && Date.now() - _channelCacheTime < CHANNEL_CACHE_TTL) {
        return { channels: _channelCache, failed: _channelListFailed, failReason: _channelListFailReason };
    }

    const channels = new Map();
    let cursor = '';
    let failed = false;
    let failReason = null;

    do {
        const qs = new URLSearchParams({
            types: 'public_channel,private_channel',
            exclude_archived: 'true',
            limit: '200',
        });
        if (cursor) qs.set('cursor', cursor);

        try {
            const res = await fetch(`https://slack.com/api/conversations.list?${qs}`, {
                headers: getAuthOnlyHeader(token),
            });
            const data = await res.json();

            if (!data.ok) {
                console.warn(`[Slack] conversations.list failed: ${data.error}`);
                failed = true;
                failReason = data.error;
                break;
            }

            for (const ch of data.channels || []) {
                channels.set(ch.name.toLowerCase(), { id: ch.id, name: ch.name });
            }

            cursor = data.response_metadata?.next_cursor || '';
        } catch (err) {
            console.warn(`[Slack] conversations.list request error: ${err.message}`);
            failed = true;
            failReason = err.message;
            break;
        }
    } while (cursor);

    // Cache the result (even if failed, so we don't spam the API)
    _channelCache = channels;
    _channelCacheTime = Date.now();
    _channelListFailed = failed;
    _channelListFailReason = failReason;

    if (channels.size > 0) {
        console.log(`[Slack] Cached ${channels.size} channels.`);
    }

    return { channels, failed, failReason };
}

/**
 * Resolves a channel name (e.g. "general", "#new-channel") to its Slack
 * channel ID (e.g. "C01234ABCDE").  If the input already looks like an ID
 * (starts with C/G/D and is alphanumeric), it is returned as-is.
 *
 * @param {string} channelNameOrId - Channel name (with/without #) or ID
 * @returns {Promise<{id: string, name: string} | null>} - Resolved channel info or null
 */
async function resolveChannelId(channelNameOrId, token) {
    // Strip leading #
    const cleaned = (channelNameOrId || '').replace(/^#/, '');

    // Already an ID? (Slack channel IDs start with C, G, or D followed by alphanumerics)
    if (/^[CGD][A-Z0-9]{8,}$/i.test(cleaned)) {
        return { id: cleaned, name: cleaned };
    }

    // Try to look up via channel list
    const { channels, failed } = await listAllChannels(token);

    // If we could list channels, look for a match
    if (!failed && channels.size > 0) {
        const match = channels.get(cleaned.toLowerCase());
        if (match) return match;
    }

    // If listing failed (missing_scope etc.) OR channel wasn't found,
    // fall back to using the name directly — Slack CAN accept channel names
    // for channels where the bot is already a member
    if (failed) {
        console.log(`[Slack] Channel listing unavailable (${_channelListFailReason}), using channel name "${cleaned}" directly.`);
    } else {
        console.warn(`[Slack] Channel "${cleaned}" not found in workspace channel list.`);
    }
    return { id: cleaned, name: cleaned };
}

/**
 * Joins a public channel by ID so the bot can post to it.
 * Returns true on success, false otherwise.
 * (Private channels require an invite — this only works for public ones.)
 */
async function joinChannel(channelId, token) {
    try {
        const res = await fetch('https://slack.com/api/conversations.join', {
            method: 'POST',
            headers: getAuthHeader(token),
            body: JSON.stringify({ channel: channelId }),
        });
        const data = await res.json();
        if (data.ok || data.error === 'already_in_channel') {
            console.log(`[Slack] ✅ Joined channel ${channelId}`);
            return true;
        }
        console.warn(`[Slack] Could not join channel ${channelId}: ${data.error}`);
        return false;
    } catch (err) {
        console.warn(`[Slack] Join request failed: ${err.message}`);
        return false;
    }
}

/**
 * Resolves a channel input string and ensures the bot is a member.
 * Falls back gracefully when API scopes are missing.
 * Returns { id, name }.
 */
async function resolveAndEnsureChannel(channelInput, token) {
    const resolved = await resolveChannelId(channelInput, token);

    // resolved is never null now — worst case it returns { id: name, name: name }
    // Try to pre-emptively join the channel (best effort — may fail if missing channels:join scope)
    await joinChannel(resolved.id, token);

    return resolved;
}

/**
 * Internal helper that POSTs to chat.postMessage, automatically joining the
 * channel on a `not_in_channel` error and retrying once.
 */
async function postWithAutoJoin(channelId, payload, token) {
    const url = 'https://slack.com/api/chat.postMessage';
    const body = { ...payload, channel: channelId };

    let response = await fetch(url, {
        method: 'POST',
        headers: getAuthHeader(token),
        body: JSON.stringify(body),
    });
    let data = await response.json();

    // Auto-join and retry on "not_in_channel" or "channel_not_found"
    if (!data.ok && (data.error === 'not_in_channel' || data.error === 'channel_not_found')) {
        console.log(`[Slack] Post failed (${data.error}) — attempting to join channel ${channelId}…`);
        const joined = await joinChannel(channelId, token);
        if (joined) {
            response = await fetch(url, {
                method: 'POST',
                headers: getAuthHeader(token),
                body: JSON.stringify(body),
            });
            data = await response.json();
        }
    }

    return data;
}

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
export async function sendSlackMessage(input, userId) {
    console.log("📢 Slack Message Invoked:", JSON.stringify(input));

    const token = await getSlackToken(userId);

    let { channel, message } = input;

    if (!message) {
        throw new Error("Message content is required.");
    }

    // Use default channel if none specified
    if (!channel) {
        const defaultCh = getDefaultChannel();
        if (!defaultCh) {
            throw new Error("No channel specified and SLACK_DEFAULT_CHANNEL not configured.");
        }
        channel = defaultCh;
    }

    // Resolve to channel ID, join the channel, and get available channels on error
    const { id: channelId, name: channelName } = await resolveAndEnsureChannel(channel, token);

    try {
        const data = await postWithAutoJoin(channelId, {
            text: message,
            mrkdwn: true,
        }, token);
        
        if (!data.ok) {
            throw new Error(`Slack API Error: ${data.error}`);
        }
        
        return JSON.stringify({
            success: true,
            channel: data.channel,
            timestamp: data.ts,
            message: `Message delivered to #${channelName}`
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
export async function sendSlackAnnouncement(input, userId) {
    console.log("📣 Slack Announcement Invoked:", JSON.stringify(input));

    const token = await getSlackToken(userId);

    let { channel, title, body, footer, type } = input;

    if (!title || !body) {
        throw new Error("Both 'title' and 'body' are required for announcements.");
    }

    // Use default channel if none specified
    if (!channel) {
        const defaultCh = getDefaultChannel();
        if (!defaultCh) {
            throw new Error("No channel specified and SLACK_DEFAULT_CHANNEL not configured.");
        }
        channel = defaultCh;
    }

    // Resolve to channel ID, join the channel, and get available channels on error
    const { id: channelId, name: channelName } = await resolveAndEnsureChannel(channel, token);
    
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
    
    try {
        const data = await postWithAutoJoin(channelId, {
            text: `${emoji} ${title}`, // Fallback for notifications
            blocks: blocks,
        }, token);
        
        if (!data.ok) {
            throw new Error(`Slack API Error: ${data.error}`);
        }
        
        return JSON.stringify({
            success: true,
            channel: data.channel,
            timestamp: data.ts,
            message: `Announcement delivered to #${channelName}`
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
export async function sendSlackLink(input, userId) {
    console.log("🔗 Slack Link Share Invoked:", JSON.stringify(input));

    const token = await getSlackToken(userId);

    let { channel, url: linkUrl, context } = input;

    if (!linkUrl) {
        throw new Error("URL is required.");
    }

    // Use default channel if none specified
    if (!channel) {
        const defaultCh = getDefaultChannel();
        if (!defaultCh) {
            throw new Error("No channel specified and SLACK_DEFAULT_CHANNEL not configured.");
        }
        channel = defaultCh;
    }

    // Resolve to channel ID, join the channel, and get available channels on error
    const { id: channelId, name: channelName } = await resolveAndEnsureChannel(channel, token);
    
    // Compose message with context and link
    const message = context 
        ? `${context}\n<${linkUrl}>`
        : `<${linkUrl}>`;
    
    try {
        const data = await postWithAutoJoin(channelId, {
            text: message,
            unfurl_links: true,
            unfurl_media: true,
        }, token);
        
        if (!data.ok) {
            throw new Error(`Slack API Error: ${data.error}`);
        }
        
        return JSON.stringify({
            success: true,
            channel: data.channel,
            timestamp: data.ts,
            message: `Link shared in #${channelName}`
        });
        
    } catch (error) {
        return JSON.stringify({
            success: false,
            error: `Failed to share link: ${error.message}`
        });
    }
}
