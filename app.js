document.addEventListener("DOMContentLoaded", () => {
  const chatForm = document.getElementById("chat-form");
  const userInput = document.getElementById("user-input");
  const chatBox = document.getElementById("chat-box");
  const voiceBtn = document.getElementById("voice-btn");

  // --- 1. VOICE RECOGNITION SETUP (STT) ---
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition;

  if (SpeechRecognition) {
      recognition = new SpeechRecognition();
      recognition.continuous = false; // Stop after one command
      recognition.lang = 'en-US';
      recognition.interimResults = false;

      // START LISTENING
      voiceBtn.addEventListener("click", () => {
          recognition.start();
          voiceBtn.classList.add("listening");
          userInput.placeholder = "Listening...";
      });

      // ON RESULT (User stopped talking)
      recognition.onresult = (event) => {
          const transcript = event.results[0][0].transcript;
          userInput.value = transcript;
          chatForm.dispatchEvent(new Event('submit')); // Auto-submit
      };

      // ON END
      recognition.onend = () => {
          voiceBtn.classList.remove("listening");
          userInput.placeholder = "Type or speak command...";
      };
  } else {
      voiceBtn.style.display = 'none';
      console.log("Web Speech API not supported in this browser.");
  }

  // --- 2. VOICE SYNTHESIS SETUP (TTS) ---
  function speak(text) {
      if (synth.speaking) {
          console.error('speechSynthesis.speaking');
          return;
      }
      
      // SAFETY CHECK: If text is NOT a string (e.g. it's an error object), convert it to text
      let textToSpeak = typeof text === 'string' ? text : "Command executed.";

      // Clean up text (remove markdown)
      const cleanText = textToSpeak.replace(/[*#]/g, ''); 

      const utterThis = new SpeechSynthesisUtterance(cleanText);
      utterThis.voice = edithVoice;
      utterThis.pitch = 1.0; 
      utterThis.rate = 1.1; 
      
      synth.speak(utterThis);
  }


  // --- 3. CHAT LOGIC ---
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
      
      // SPEAK THE ANSWER
      speak(data.answer);

    } catch (error) {
      console.error(error);
      const errMsg = `System Error: ${error.message || "Connection lost. Tactical systems offline."}`;
      addMessage(errMsg, "assistant");
      speak("System error detected.");
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