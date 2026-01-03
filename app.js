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
  const synth = window.speechSynthesis;
  let edithVoice = null;

  function loadVoices() {
      const voices = synth.getVoices();
      // Try to find a "Google UK English Female" or standard female voice for that Jarvis/EDITH feel
      edithVoice = voices.find(voice => voice.name.includes('Google UK English Female')) 
                || voices.find(voice => voice.name.includes('Microsoft Hazel')) 
                || voices.find(voice => voice.name.includes('Samantha'))
                || voices[0];
  }

  // Load voices immediately and whenever they change
  loadVoices();
  if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
  }

  function speak(text) {
      if (synth.speaking) {
          console.error('speechSynthesis.speaking');
          return;
      }
      
      // Clean up text (remove markdown like ** or ## for smoother speech)
      const cleanText = text.replace(/[*#]/g, ''); 

      const utterThis = new SpeechSynthesisUtterance(cleanText);
      utterThis.voice = edithVoice;
      utterThis.pitch = 1.0; // Standard pitch
      utterThis.rate = 1.1;  // Slightly faster for efficiency
      
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
      const response = await fetch("/api/ask", {
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
      const errMsg = "Connection lost. Tactical systems offline.";
      addMessage(errMsg, "assistant");
      speak(errMsg);
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