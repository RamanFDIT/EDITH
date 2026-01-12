document.addEventListener("DOMContentLoaded", () => {
  const chatForm = document.getElementById("chat-form");
  const userInput = document.getElementById("user-input");
  const chatBox = document.getElementById("chat-box");
  const lockScreen = document.getElementById("lock-screen");
  const authPassword = document.getElementById("auth-password");
  const authSubmit = document.getElementById("auth-submit");
  const biometricBtn = document.getElementById("biometric-btn");
  const authMsg = document.getElementById("auth-msg");

  // --- AUTHENTICATION LOGIC ---
  
  // 1. Password Auth
  authSubmit.addEventListener("click", () => attemptUnlock(authPassword.value));
  authPassword.addEventListener("keypress", (e) => {
    if (e.key === "Enter") attemptUnlock(authPassword.value);
  });

  // 2. Biometric Auth (WebAuthn Hack)
  biometricBtn.addEventListener("click", async () => {
    if (!window.PublicKeyCredential) {
      authMsg.textContent = "BIOMETRIC HARDWARE NOT DETECTED";
      authMsg.style.color = "red";
      return;
    }

    try {
      authMsg.textContent = "INITIATING SCAN...";
      authMsg.style.color = "cyan";

      // Challenge doesn't matter for local lock
      const challenge = new Uint8Array(32); 
      window.crypto.getRandomValues(challenge);

      const publicKey = {
        challenge: challenge,
        rp: { name: "EDITH Tactical" },
        user: {
          id: new Uint8Array(16),
          name: "raman@stark.industries",
          displayName: "Raman"
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { userVerification: "required" },
        timeout: 60000
      };

      // This triggers Windows Hello / Touch ID
      await navigator.credentials.create({ publicKey });
      
      // If we get here, the OS verified the user
      attemptUnlock("Protocol Zero"); 

    } catch (err) {
      console.error(err);
      authMsg.textContent = "SCAN FAILED / CANCELED";
      authMsg.style.color = "red";
    }
  });

  async function attemptUnlock(passcode) {
      try {
        const response = await fetch("http://localhost:3000/api/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: passcode }),
        });

        const data = await response.json();
        
        // Check if server unlocked
        if (data.answer && data.answer.includes("✅ AUTHENTICATION VERIFIED")) {
            unlockUI();
            addMessage(data.answer, "assistant"); // Show the welcome message
        } else if (data.answer && data.answer.includes("🔒 ACCESS DENIED")) {
             authMsg.textContent = "INVALID PASSCODE";
             authMsg.style.color = "red";
             authPassword.classList.add("shake");
             setTimeout(() => authPassword.classList.remove("shake"), 500);
        } else {
             // Already unlocked or other response
             unlockUI(); 
        }

      } catch (error) {
           authMsg.textContent = "SERVER UNREACHABLE";
      }
  }

  function unlockUI() {
      lockScreen.style.opacity = "0";
      setTimeout(() => {
          lockScreen.style.display = "none";
      }, 500);
  }

  // --- CHAT LOGIC ---
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = userInput.value;
    if (!question) return;

    // Display User Message
    addMessage(question, "user");
    userInput.value = "";

    try {
      const response = await fetch("http://localhost:3000/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question }),
      });

      if (!response.ok) throw new Error("Network Error");

      const data = await response.json();
      
      // Display AI Message
      addMessage(data.answer, "assistant");

    } catch (error) {
      console.error(error);
      const errMsg = `System Error: ${error.message || "Connection lost. Tactical systems offline."}`;
      addMessage(errMsg, "assistant");
    }
  });

  function addMessage(text, sender) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", sender);
    // Render Markdown-ish text simply
    messageElement.innerHTML = `<p>${text.replace(/\n/g, '<br>')}</p>`;
    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
});