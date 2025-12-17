# EDITH Core - Capstone

## Setup

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Create a `.env` file with your API keys:
    ```
    GOOGLE_API_KEY=your_google_api_key
    JIRA_API_TOKEN=your_jira_token
    JIRA_EMAIL=your_jira_email
    JIRA_DOMAIN=your_jira_domain
    GITHUB_TOKEN=your_github_token
    ```

## Running the Application

1.  Start the server:
    ```bash
    node server.js
    ```
2.  Open your browser and navigate to:
    ```
    http://localhost:3000
    ```

## Troubleshooting

-   If you see "Network response was not ok", check the server console for errors.
-   Ensure you are accessing the app via `http://localhost:3000` and NOT by opening `index.html` directly.
