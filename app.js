// Wait for the DOM to load
document.addEventListener("DOMContentLoaded", () => {
  const chatForm = document.getElementById("chat-form");
  const userInput = document.getElementById("user-input");
  const chatBox = document.getElementById("chat-box");

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault(); // Stop the form from reloading the page
    
    const question = userInput.value;
    if (!question) return; // Don't send empty messages

    // 1. Display the user's question in the chat
    addMessage(question, "user");
    userInput.value = ""; // Clear the input field

    // 2. Send the question to your Express server
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ question: question }),
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const data = await response.json();
      
      // 3. Display the AI's answer in the chat
      addMessage(data.answer, "assistant");

    } catch (error) {
      console.error("Error fetching from server:", error);
      addMessage("Sorry, I'm having trouble connecting to my brain. Please check the server.", "assistant");
    }
  });

  function addMessage(text, sender) {
    const messageElement = document.createElement("div");
    messageElement.classList.add("message", sender);
    messageElement.innerHTML = `<p>${text}</p>`;
    chatBox.appendChild(messageElement);
    chatBox.scrollTop = chatBox.scrollHeight; // Scroll to bottom
  }
});