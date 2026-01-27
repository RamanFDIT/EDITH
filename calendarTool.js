import { google } from 'googleapis';
import './envConfig.js';

// Load credentials from environment
const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const REFRESH_TOKEN = (process.env.GOOGLE_REFRESH_TOKEN || '').trim();

// Initialize OAuth2 client
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);

// Set the refresh token - googleapis will auto-refresh access tokens
oauth2Client.setCredentials({
    refresh_token: REFRESH_TOKEN
});

// Create calendar instance
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

/**
 * Check if calendar is configured
 */
function checkConfig() {
    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
        throw new Error(
            'Missing Google Calendar credentials. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in your .env file. Run "node getGoogleToken.js" to get the refresh token.'
        );
    }
}

// --- TOOL 1: GET UPCOMING EVENTS ---
export async function getCalendarEvents(input) {
    console.log("📅 Calendar Get Events Invoked:", JSON.stringify(input));
    checkConfig();
    
    const { 
        maxResults = 10, 
        timeMin, 
        timeMax,
        calendarId = 'primary'
    } = input;

    try {
        const response = await calendar.events.list({
            calendarId: calendarId,
            timeMin: timeMin || new Date().toISOString(),
            timeMax: timeMax || undefined,
            maxResults: maxResults,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = response.data.items || [];
        
        if (events.length === 0) {
            return JSON.stringify({ message: "No upcoming events found.", events: [] });
        }

        const formattedEvents = events.map(event => ({
            id: event.id,
            summary: event.summary,
            description: event.description || '',
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            location: event.location || '',
            attendees: event.attendees?.map(a => a.email) || [],
            htmlLink: event.htmlLink
        }));

        return JSON.stringify({ events: formattedEvents });
    } catch (error) {
        console.error("Calendar API Error:", error);
        return `Error fetching calendar events: ${error.message}`;
    }
}

// --- TOOL 2: CREATE EVENT ---
export async function createCalendarEvent(input) {
    console.log("📅 Calendar Create Event Invoked:", JSON.stringify(input));
    checkConfig();

    const {
        summary,
        description,
        startDateTime,
        endDateTime,
        location,
        attendees,
        calendarId = 'primary',
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } = input;

    if (!summary || !startDateTime || !endDateTime) {
        throw new Error("Missing required fields: summary, startDateTime, and endDateTime are mandatory.");
    }

    try {
        const event = {
            summary: summary,
            description: description || '',
            location: location || '',
            start: {
                dateTime: startDateTime,
                timeZone: timeZone,
            },
            end: {
                dateTime: endDateTime,
                timeZone: timeZone,
            },
        };

        // Add attendees if provided
        if (attendees && attendees.length > 0) {
            event.attendees = attendees.map(email => ({ email }));
        }

        const response = await calendar.events.insert({
            calendarId: calendarId,
            resource: event,
            sendUpdates: attendees ? 'all' : 'none',
        });

        return JSON.stringify({
            message: "Event created successfully!",
            event: {
                id: response.data.id,
                summary: response.data.summary,
                htmlLink: response.data.htmlLink,
                start: response.data.start,
                end: response.data.end
            }
        });
    } catch (error) {
        console.error("Calendar API Error:", error);
        return `Error creating calendar event: ${error.message}`;
    }
}

// --- TOOL 3: UPDATE EVENT ---
export async function updateCalendarEvent(input) {
    console.log("📅 Calendar Update Event Invoked:", JSON.stringify(input));
    checkConfig();

    const {
        eventId,
        summary,
        description,
        startDateTime,
        endDateTime,
        location,
        calendarId = 'primary',
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } = input;

    if (!eventId) {
        throw new Error("Missing required field: eventId is mandatory.");
    }

    try {
        // First get the existing event
        const existingEvent = await calendar.events.get({
            calendarId: calendarId,
            eventId: eventId,
        });

        // Update only provided fields
        const updatedEvent = {
            ...existingEvent.data,
            summary: summary || existingEvent.data.summary,
            description: description !== undefined ? description : existingEvent.data.description,
            location: location !== undefined ? location : existingEvent.data.location,
        };

        if (startDateTime) {
            updatedEvent.start = { dateTime: startDateTime, timeZone };
        }
        if (endDateTime) {
            updatedEvent.end = { dateTime: endDateTime, timeZone };
        }

        const response = await calendar.events.update({
            calendarId: calendarId,
            eventId: eventId,
            resource: updatedEvent,
        });

        return JSON.stringify({
            message: "Event updated successfully!",
            event: {
                id: response.data.id,
                summary: response.data.summary,
                htmlLink: response.data.htmlLink
            }
        });
    } catch (error) {
        console.error("Calendar API Error:", error);
        return `Error updating calendar event: ${error.message}`;
    }
}

// --- TOOL 4: DELETE EVENT ---
export async function deleteCalendarEvent(input) {
    console.log("📅 Calendar Delete Event Invoked:", JSON.stringify(input));
    checkConfig();

    const { eventId, calendarId = 'primary' } = input;

    if (!eventId) {
        throw new Error("Missing required field: eventId is mandatory.");
    }

    try {
        await calendar.events.delete({
            calendarId: calendarId,
            eventId: eventId,
        });

        return JSON.stringify({
            message: `Event ${eventId} deleted successfully!`
        });
    } catch (error) {
        console.error("Calendar API Error:", error);
        return `Error deleting calendar event: ${error.message}`;
    }
}

// --- TOOL 5: FIND FREE TIME ---
export async function findFreeTime(input) {
    console.log("📅 Calendar Find Free Time Invoked:", JSON.stringify(input));
    checkConfig();

    const {
        timeMin,
        timeMax,
        calendarId = 'primary',
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    } = input;

    if (!timeMin || !timeMax) {
        throw new Error("Missing required fields: timeMin and timeMax are mandatory.");
    }

    try {
        const response = await calendar.freebusy.query({
            resource: {
                timeMin: timeMin,
                timeMax: timeMax,
                timeZone: timeZone,
                items: [{ id: calendarId }]
            }
        });

        const busyTimes = response.data.calendars[calendarId]?.busy || [];

        return JSON.stringify({
            timeRange: { start: timeMin, end: timeMax },
            busyTimes: busyTimes,
            message: busyTimes.length === 0 
                ? "You're completely free during this time range!" 
                : `Found ${busyTimes.length} busy period(s) in this time range.`
        });
    } catch (error) {
        console.error("Calendar API Error:", error);
        return `Error checking free time: ${error.message}`;
    }
}

// --- TOOL DEFINITIONS FOR LANGCHAIN ---
export const calendarToolDefinitions = [
    {
        name: "get_calendar_events",
        description: "Get upcoming events from Google Calendar. Use this to check what meetings or events are scheduled.",
        schema: {
            type: "object",
            properties: {
                maxResults: {
                    type: "number",
                    description: "Maximum number of events to return. Default is 10."
                },
                timeMin: {
                    type: "string",
                    description: "Start time for events query in ISO format (e.g., 2024-01-15T09:00:00Z). Defaults to now."
                },
                timeMax: {
                    type: "string",
                    description: "End time for events query in ISO format. Optional."
                },
                calendarId: {
                    type: "string",
                    description: "Calendar ID to query. Defaults to 'primary'."
                }
            },
            required: []
        }
    },
    {
        name: "create_calendar_event",
        description: "Create a new event on Google Calendar. Use this to schedule meetings, appointments, or reminders.",
        schema: {
            type: "object",
            properties: {
                summary: {
                    type: "string",
                    description: "Title of the event"
                },
                description: {
                    type: "string",
                    description: "Description or notes for the event"
                },
                startDateTime: {
                    type: "string",
                    description: "Start date and time in ISO format (e.g., 2024-01-15T14:00:00)"
                },
                endDateTime: {
                    type: "string",
                    description: "End date and time in ISO format (e.g., 2024-01-15T15:00:00)"
                },
                location: {
                    type: "string",
                    description: "Location of the event"
                },
                attendees: {
                    type: "array",
                    items: { type: "string" },
                    description: "Array of email addresses to invite"
                },
                timeZone: {
                    type: "string",
                    description: "Timezone for the event (e.g., 'America/New_York'). Defaults to system timezone."
                }
            },
            required: ["summary", "startDateTime", "endDateTime"]
        }
    },
    {
        name: "update_calendar_event",
        description: "Update an existing event on Google Calendar. Use this to change meeting details.",
        schema: {
            type: "object",
            properties: {
                eventId: {
                    type: "string",
                    description: "The ID of the event to update"
                },
                summary: {
                    type: "string",
                    description: "New title for the event"
                },
                description: {
                    type: "string",
                    description: "New description for the event"
                },
                startDateTime: {
                    type: "string",
                    description: "New start date and time in ISO format"
                },
                endDateTime: {
                    type: "string",
                    description: "New end date and time in ISO format"
                },
                location: {
                    type: "string",
                    description: "New location for the event"
                }
            },
            required: ["eventId"]
        }
    },
    {
        name: "delete_calendar_event",
        description: "Delete an event from Google Calendar.",
        schema: {
            type: "object",
            properties: {
                eventId: {
                    type: "string",
                    description: "The ID of the event to delete"
                }
            },
            required: ["eventId"]
        }
    },
    {
        name: "find_free_time",
        description: "Check for free/busy time in a given time range. Use this to find available slots for scheduling.",
        schema: {
            type: "object",
            properties: {
                timeMin: {
                    type: "string",
                    description: "Start of time range to check in ISO format"
                },
                timeMax: {
                    type: "string",
                    description: "End of time range to check in ISO format"
                }
            },
            required: ["timeMin", "timeMax"]
        }
    }
];
