# E.D.I.T.H. Security & Performance Optimization Plan

**Project:** E.D.I.T.H. Core (Capstone)
**Target Environment:** Electron Desktop Application & Local Node.js Server

---

## Executive Summary
E.D.I.T.H. is a sophisticated AI-powered desktop assistant featuring deep integration with the operating system, productivity tools, and local/cloud LLMs. Because it functions as a highly-privileged local agent capable of reading files, sending messages, and executing system commands, it requires a robust security posture to prevent exploitation (e.g., Prompt Injection leading to Remote Code Execution). Additionally, as a conversational interface, its performance must be near-instantaneous to feel natural. 

This document outlines critical vulnerabilities, performance bottlenecks, and a strategic roadmap to harden and optimize the application.

---

## Part 1: Security Audit & Remediation

### 1. Command Injection & Arbitrary Code Execution (High Severity)
**Vulnerability:** 
In `systemTool.js`, the `executeSystemCommand` and `openApplication` functions pass LLM-generated strings directly to `child_process.exec` or use weak regex sanitization. An attacker could craft a malicious prompt (e.g., via a loaded document, an incoming Slack message, or a malicious calendar invite) that tricks the LLM into executing dangerous shell commands (Prompt Injection).

**Remediation Plan:**
*   **Deprecate Raw `exec`:** Never pass raw LLM output to a shell. 
*   **Use Strict Allowlists:** Create an allowlist of permitted commands or applications. 
*   **Use `child_process.spawn`:** When executing commands, use `spawn` and pass arguments as an array rather than a single concatenated string. This prevents the shell from interpreting special characters (like `&`, `|`, `;`).
*   **Sandboxing:** Consider running system commands in an isolated, low-privilege background process.

### 2. Insecure Secret Storage (High Severity)
**Vulnerability:** 
OAuth tokens, API keys, and user settings are currently stored in plaintext JSON files on the disk via `electron-store` in `store.js`. If a malicious script or application gains access to the file system, these highly privileged tokens can be stolen.

**Remediation Plan:**
*   **Implement Electron `safeStorage`:** Use Electron's native `safeStorage` API to encrypt sensitive tokens before writing them to disk. This leverages the OS-level credential managers (Keychain on macOS, DPAPI on Windows, Secret Service on Linux).
*   **Memory Only:** Keep decrypted tokens in memory for the duration of the session and never log them to the console.

### 3. Path Traversal via File Uploads (Medium Severity)
**Vulnerability:** 
The file upload endpoint in `server.js` uses `file.originalname` when saving files to the `temp` directory. A maliciously crafted filename (e.g., `../../../Windows/System32/malicious.dll`) could allow an attacker to overwrite arbitrary files on the system.

**Remediation Plan:**
*   **Sanitize Filenames:** Generate a secure, random filename (e.g., using UUIDs) for all uploaded files.
*   **Store Metadata Separately:** Keep the `originalname` in memory or a local database for UI display purposes only, mapped to the securely generated filename on disk.

### 4. Permissive CORS (Medium Severity)
**Vulnerability:** 
The Express server (`server.js`) enables CORS globally (`cors()`). Any website the user visits in their browser could potentially make requests to the local E.D.I.T.H. server (e.g., `http://localhost:3000`), triggering unintended actions.

**Remediation Plan:**
*   **Strict Origin Allowlist:** Restrict CORS specifically to the Electron app's custom protocol (e.g., `edith://`) or the exact `localhost` port the React frontend is served on.

---

## Part 2: Performance Optimization

### 1. Agent Initialization Overhead
**Bottleneck:** 
Currently, `agent.js` dynamically creates a fresh LangGraph agent instance (`createReactAgent`) for every single incoming request. Compiling the graph and binding tools on the fly adds noticeable latency before the LLM even begins processing.

**Optimization Plan:**
*   **Agent Caching (Singleton Pattern):** Pre-initialize the base agent at startup and reuse it across requests. 
*   **Dynamic Tool Binding:** If different intents require different toolsets, pre-compile several specialized agents (e.g., `JiraAgent`, `SystemAgent`) and route the request to the existing instance.

### 2. Intent Classification Latency ("Traffic Cop")
**Bottleneck:** 
The "Slow Pass" semantic routing relies on an LLM call to classify ambiguous queries. This means the user waits for a full round-trip LLM response just to figure out *which* tools to use, before the actual answer generation begins.

**Optimization Plan:**
*   **Fast-Pass Enhancement:** Improve the keyword mapping/regex heuristic to catch 80-90% of intents without an LLM.
*   **Local Small Models:** For the "Slow Pass", use an extremely fast, quantized local model (like `llama3.2:1b` or `phi-3-mini` via Ollama) dedicated purely to classification, leaving the heavy lifting for the main model.

### 3. Asynchronous Audio Generation (TTS) Ordering
**Bottleneck:** 
`generateAudioChunk` is a "fire-and-forget" function. While this prevents blocking the SSE text stream, it can lead to overlapping audio or sentences playing out of order if a shorter sentence finishes generating before a longer preceding sentence.

**Optimization Plan:**
*   **Implement a TTS Queue:** Create an audio manager that pushes sentences into a queue as they are generated by the LLM. The TTS engine processes the queue sequentially, ensuring audio chunks are delivered to the frontend in the correct grammatical order.

### 4. Chat History File I/O
**Bottleneck:** 
`JSONFileChatMessageHistory` repeatedly reads and parses the entire chat history JSON file from disk. As the conversation grows over days or weeks, this synchronous I/O will block the Node.js event loop and degrade performance.

**Optimization Plan:**
*   **In-Memory Cache:** Maintain the active conversation history in memory (e.g., a simple array) and perform asynchronous, debounced writes to the disk.
*   **Pagination/Pruning:** Implement a sliding window for context (e.g., only pass the last 10-20 messages to the LLM) to reduce both token usage and disk read times.

---

## Next Steps for the Frontend Developer
Since you are focusing on the frontend, you don't need to fix all of these backend issues alone. The best approach is to:
1. **Prioritize the UI/UX:** Ensure the Electron React app feels smooth, handles the streaming SSE elegantly, and looks great.
2. **Review the Plan:** Keep this document as part of your Capstone submission to demonstrate architectural awareness.
3. **Tackle Low-Hanging Fruit:** The CORS and Path Traversal issues in `server.js` are small code changes that are easy to implement securely.