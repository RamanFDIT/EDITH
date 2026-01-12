document.addEventListener("DOMContentLoaded", () => {
  const chatForm = document.getElementById("chat-form");
  const userInput = document.getElementById("user-input");
  const chatBox = document.getElementById("chat-box");

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