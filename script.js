// ==================== script.js - FINAL HARDENED VERSION ====================
// Includes: choices validation, hard fallback, debug log, speak validation, memory, command router

// ---------- DOM Elements ----------
const chatMessages = document.getElementById('chatMessages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const thinkingIndicator = document.getElementById('thinkingIndicator');
const thinkingTextSpan = document.getElementById('thinkingText');
const voiceStatusSpan = document.getElementById('voiceStatus');
const aiOrb = document.getElementById('aiOrb');
const soundWave = document.getElementById('soundWave');
const continuousModeToggle = document.getElementById('continuousModeToggle');

// ---------- App State ----------
let openRouterApiKey = localStorage.getItem('zara_openrouter_key') || '';
let isListening = false;
let recognition = null;
let synth = window.speechSynthesis;
let continuousMode = true;
let isSpeaking = false;
let pendingRestart = false;

// ---------- Memory System (persistent) ----------
let zaraMemory = JSON.parse(localStorage.getItem('zara_memory')) || {
    name: "Subha",
    interests: ["technology", "AI"],
    preferences: { continuousMode: true },
    lastSeen: Date.now(),
    conversationCount: 0
};

function saveMemory() {
    localStorage.setItem('zara_memory', JSON.stringify(zaraMemory));
}
saveMemory();

// ---------- Voice Loading ----------
let availableVoices = [];
function loadVoices() { availableVoices = speechSynthesis.getVoices(); }
loadVoices();
if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = loadVoices;

// ---------- Site Map ----------
const siteMap = {
    youtube: 'https://youtube.com', gmail: 'https://mail.google.com', whatsapp: 'https://web.whatsapp.com',
    instagram: 'https://instagram.com', github: 'https://github.com', twitter: 'https://x.com',
    reddit: 'https://reddit.com', spotify: 'https://spotify.com', netflix: 'https://netflix.com',
    facebook: 'https://facebook.com', linkedin: 'https://linkedin.com', amazon: 'https://amazon.com',
    twitch: 'https://twitch.tv', discord: 'https://discord.com', google: 'https://google.com',
    bing: 'https://bing.com', cnn: 'https://cnn.com', bbc: 'https://bbc.com', reuters: 'https://reuters.com',
    wikipedia: 'https://wikipedia.org'
};

// ---------- UI Helpers (Markdown enabled) ----------
function renderMessage(text, isUser, toolData = null, isError = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
    if (isError) messageDiv.style.opacity = '0.7';
    const avatarIcon = isUser ? '<i class="fas fa-user-astronaut"></i>' : '<i class="fas fa-microchip"></i>';
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' });
    let sourceHtml = '';
    if (toolData?.sourceLinks?.length) {
        sourceHtml = `<div class="source-links">${toolData.sourceLinks.map(link => `<a href="${link.url}" target="_blank" class="source-link"><i class="fas fa-external-link-alt"></i> ${link.label}</a>`).join('')}</div>`;
    }
    let contentHtml = text;
    if (!isUser && typeof marked !== 'undefined') {
        contentHtml = marked.parse(text);
    }
    messageDiv.innerHTML = `
        <div class="avatar">${avatarIcon}</div>
        <div class="content">${contentHtml}${sourceHtml}</div>
        <div class="timestamp">${timestamp}</div>
    `;
    chatMessages.appendChild(messageDiv);
    messageDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function addSystemMessage(text, isError = false) { renderMessage(text, false, null, isError); }
function addMessage(text, isUser, toolData = null) {
    renderMessage(text, isUser, toolData);
    let history = JSON.parse(localStorage.getItem('zara_chat_history') || '[]');
    history.push({ role: isUser ? 'user' : 'assistant', content: text, timestamp: Date.now() });
    if (history.length > 100) history = history.slice(-100);
    localStorage.setItem('zara_chat_history', JSON.stringify(history));
    zaraMemory.conversationCount++;
    saveMemory();
}

// ---------- Speech with queue protection ----------
function speakText(text) {
    if (!synth) return;
    if (synth.speaking) synth.cancel();
    isSpeaking = true;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.1;
    const voices = availableVoices.length ? availableVoices : synth.getVoices();
    utterance.voice = voices.find(v => v.name.includes("Google")) ||
                      voices.find(v => v.name.includes("Microsoft")) ||
                      voices.find(v => v.lang === "en-US") || voices[0];
    utterance.onend = () => {
        isSpeaking = false;
        if (continuousMode && !isListening && !pendingRestart && !userInput.value.trim()) {
            pendingRestart = true;
            setTimeout(() => {
                if (continuousMode && !isListening && !isSpeaking) startListening();
                pendingRestart = false;
            }, 500);
        }
    };
    synth.speak(utterance);
}

// ---------- Weather (local fetch) ----------
async function fetchDetailedWeather(location) {
    try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
        const geoRes = await fetch(geoUrl);
        const geoData = await geoRes.json();
        if (!geoData.results?.length) return null;
        const { latitude, longitude, name } = geoData.results[0];
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=relative_humidity_2m,apparent_temperature,precipitation_probability&timezone=auto`;
        const wRes = await fetch(weatherUrl);
        const wData = await wRes.json();
        if (!wData.current_weather) return null;
        const temp = wData.current_weather.temperature;
        const wind = wData.current_weather.windspeed;
        const weatherCode = wData.current_weather.weathercode;
        const humidity = wData.hourly?.relative_humidity_2m?.[0] || "N/A";
        const feelsLike = wData.hourly?.apparent_temperature?.[0] || temp;
        const rainProb = wData.hourly?.precipitation_probability?.[0] || 0;
        let condition = "Clear";
        if (weatherCode >= 51 && weatherCode <= 67) condition = "Drizzle/Rain";
        else if (weatherCode >= 71 && weatherCode <= 77) condition = "Snow";
        else if (weatherCode >= 80 && weatherCode <= 99) condition = "Thunderstorm";
        let clothingTip = temp > 30 ? "Wear light clothes." : (temp < 10 ? "Heavy jacket needed." : "Comfortable.");
        let umbrellaTip = rainProb > 50 ? "Bring an umbrella!" : (rainProb > 20 ? "Maybe an umbrella." : "");
        let travelWarning = wind > 30 ? "Strong winds – be careful." : "";
        return { summary: `📍 ${name}: ${temp}°C, feels like ${feelsLike}°C. Humidity ${humidity}%, wind ${wind} km/h, ${condition}. Rain chance ${rainProb}%. ${clothingTip} ${umbrellaTip} ${travelWarning}` };
    } catch(e) { return null; }
}

async function executeToolCommand(toolObj) {
    const { tool, speak, open: urlToOpen, query } = toolObj;
    if (speak) {
        speakText(speak);
        addMessage(speak, false, { sourceLinks: urlToOpen ? [{ label: `Open ${tool.toUpperCase()}`, url: urlToOpen }] : [] });
    } else addMessage("Action completed.", false);
    if (urlToOpen) {
        setTimeout(() => { const newWin = window.open(urlToOpen, '_blank'); if (!newWin) addSystemMessage("⚠️ Popup blocked.", true); }, 800);
    }
    if (tool === 'weather' && query) {
        let loc = query.replace(/weather|in|for|current/gi, '').trim() || "London";
        const data = await fetchDetailedWeather(loc);
        if (data) { addMessage(data.summary, false); speakText(data.summary); } 
        else addMessage("Weather fetch failed.", false);
    }
    if (tool === 'news') setTimeout(() => window.open('https://www.reuters.com/', '_blank'), 1000);
}

// ==================== COMMAND HANDLERS ====================
const commandHandlers = [];

function handleTime(text) {
    if (/\btime\b/.test(text)) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute:'2-digit', second:'2-digit' });
        addMessage(`The current time is ${timeStr}.`, false); speakText(`The current time is ${timeStr}.`);
        return true;
    }
    return false;
}
commandHandlers.push(handleTime);

function handleDate(text) {
    if (/\bdate\b/.test(text)) {
        const now = new Date();
        const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        addMessage(`Today is ${dateStr}.`, false); speakText(`Today is ${dateStr}.`);
        return true;
    }
    return false;
}
commandHandlers.push(handleDate);

function handleMath(text) {
    if (!/[0-9+\-*/().]/.test(text)) return false;
    let sanitized = text.replace(/[^0-9+\-*/().]/g, '');
    if (!sanitized) return false;
    try {
        const result = Function(`return ${sanitized}`)();
        if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
            addMessage(`${sanitized} = ${result}`, false); speakText(`${sanitized} = ${result}`);
            return true;
        }
    } catch(e) {}
    return false;
}
commandHandlers.push(handleMath);

function handleWeather(text) {
    if (/\bweather\b/.test(text)) {
        executeToolCommand({ tool: "weather", query: text });
        return true;
    }
    return false;
}
commandHandlers.push(handleWeather);

function handleOpenSite(text) {
    if (/^open\s+\w+/.test(text)) {
        const site = text.replace(/^open\s+/, '').trim().toLowerCase();
        if (siteMap[site]) {
            executeToolCommand({ tool: "open_site", speak: `Opening ${site}.`, open: siteMap[site], query: site });
            return true;
        } else {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(site)}`;
            executeToolCommand({ tool: "open_site", speak: `Searching Google for "${site}".`, open: searchUrl, query: site });
            return true;
        }
    }
    return false;
}
commandHandlers.push(handleOpenSite);

function handleYouTubeSearch(text) {
    if (/\bsearch.*youtube\b/.test(text) || /\byoutube.*search\b/.test(text)) {
        let query = text.replace(/search|on|youtube/gi, '').trim();
        if (query) {
            const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
            executeToolCommand({ tool: "youtube", speak: `Searching YouTube for ${query}.`, open: url, query });
            return true;
        }
    }
    return false;
}
commandHandlers.push(handleYouTubeSearch);

function handleGreeting(text) {
    if (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(text)) {
        const hour = new Date().getHours();
        let greeting = "Hello";
        if (hour < 12) greeting = "Good morning";
        else if (hour < 18) greeting = "Good afternoon";
        else greeting = "Good evening";
        addMessage(`${greeting}, ${zaraMemory.name}! I'm Zara. How can I help you today?`, false);
        speakText(`${greeting}, ${zaraMemory.name}! I'm Zara. How can I help you today?`);
        return true;
    }
    return false;
}
commandHandlers.push(handleGreeting);

function handleThanks(text) {
    if (/\b(thank|thanks)\b/.test(text)) {
        addMessage("You're very welcome! I'm happy to help.", false);
        speakText("You're very welcome! I'm happy to help.");
        return true;
    }
    if (/\b(goodbye|bye)\b/.test(text)) {
        addMessage("Goodbye! Come back anytime.", false);
        speakText("Goodbye! Come back anytime.");
        return true;
    }
    return false;
}
commandHandlers.push(handleThanks);

function handleHelp(text) {
    if (/\b(what can you do|help|capabilities)\b/.test(text)) {
        const reply = "I can tell time and date, do math, open websites, search YouTube, fetch live weather, get news, answer questions, and remember our conversation.";
        addMessage(reply, false); speakText(reply);
        return true;
    }
    return false;
}
commandHandlers.push(handleHelp);

function handleSetName(text) {
    const match = text.match(/my name is (\w+)/i);
    if (match) {
        zaraMemory.name = match[1];
        saveMemory();
        addMessage(`Nice to meet you, ${zaraMemory.name}! I'll remember that.`, false);
        speakText(`Nice to meet you, ${zaraMemory.name}! I'll remember that.`);
        return true;
    }
    return false;
}
commandHandlers.push(handleSetName);

function handleLocalCommand(text) {
    for (const handler of commandHandlers) {
        if (handler(text)) return true;
    }
    return false;
}

// ==================== AI CALL WITH ROBUST ERROR HANDLING ====================
async function askZara(userPrompt) {
    if (handleLocalCommand(userPrompt)) return;

    openRouterApiKey = localStorage.getItem('zara_openrouter_key') || '';
    if (!openRouterApiKey.trim()) {
        addSystemMessage("❌ No API key found. Please enter your OpenRouter API key.", true);
        speakText("Please set your API key first.");
        return;
    }

    thinkingIndicator.classList.add('active');
    thinkingTextSpan.innerText = "Zara is thinking...";

    try {
        let history = JSON.parse(localStorage.getItem('zara_chat_history') || '[]');
        let recent = history.slice(-30);
        const systemPrompt = `You are Zara, a futuristic AI assistant. The user's name is ${zaraMemory.name}. Their interests include ${zaraMemory.interests.join(', ')}. Be conversational, warm, and helpful. Answer general knowledge questions accurately. Use tools only when clearly needed (weather, news, open website). Respond ONLY in valid JSON.

Format: {"tool":"weather|news|youtube|wikipedia|google|open_site|none","speak":"your natural answer","open":"optional url","query":"optional"}
For weather, include query. For normal chat, tool "none". Never add extra text.`;

        const messages = [
            { role: "system", content: systemPrompt },
            ...recent.map(m => ({ role: m.role, content: m.content })),
            { role: "user", content: userPrompt }
        ];

        // You can change the model here if needed (examples below)
        // Model options (free on OpenRouter):
        // - "deepseek/deepseek-chat-v3-0324:free" (current)
        // - "mistralai/mistral-7b-instruct:free"
        // - "google/gemma-3-27b-it:free"
        // - "meta-llama/llama-3.3-70b-instruct:free"
        const model = "deepseek/deepseek-chat-v3-0324:free";

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openRouterApiKey.trim()}`,
                "Content-Type": "application/json",
                "HTTP-Referer": window.location.origin,
                "X-Title": "Zara AI Assistant"
            },
            body: JSON.stringify({
                model: model,
                messages,
                temperature: 0.7,
                max_tokens: 700
            })
        });

        if (!response.ok) throw new Error(`API Error ${response.status}`);
        const data = await response.json();

        // CRITICAL: Validate that choices exist
        if (!data.choices || !data.choices.length) {
            throw new Error("No AI response received (empty choices)");
        }

        let aiRaw = data.choices[0].message.content;
        console.log("RAW AI RESPONSE:", aiRaw);

        aiRaw = aiRaw.replace(/```json/g, '').replace(/```/g, '').trim();
        let aiJson = null;
        const match = aiRaw.match(/\{[\s\S]*\}/);
        if (match) {
            try { aiJson = JSON.parse(match[0]); } catch(e) { console.warn("JSON parse error", e); }
        }

        // Hard fallback
        if (!aiJson) {
            aiJson = {
                tool: "none",
                speak: (typeof aiRaw === "string" && aiRaw.trim().length) ? aiRaw.trim() : "I couldn't generate a proper response."
            };
        }

        // Validate speak property
        if (!aiJson.speak || typeof aiJson.speak !== "string") {
            aiJson.speak = "I couldn't understand the response properly.";
        }

        const validTools = ['weather', 'news', 'youtube', 'wikipedia', 'google', 'open_site', 'none'];
        if (!validTools.includes(aiJson.tool)) aiJson.tool = 'none';

        if (aiJson.tool === 'youtube' && aiJson.query) aiJson.open = `https://www.youtube.com/results?search_query=${encodeURIComponent(aiJson.query)}`;
        else if (aiJson.tool === 'wikipedia' && aiJson.query) aiJson.open = `https://en.wikipedia.org/wiki/${encodeURIComponent(aiJson.query.replace(/ /g, '_'))}`;
        else if (aiJson.tool === 'google' && aiJson.query) aiJson.open = `https://www.google.com/search?q=${encodeURIComponent(aiJson.query)}`;
        else if (aiJson.tool === 'open_site' && aiJson.query) {
            const siteKey = aiJson.query.toLowerCase().trim();
            aiJson.open = siteMap[siteKey] || `https://www.google.com/search?q=${encodeURIComponent(siteKey)}`;
            if (!siteMap[siteKey] && !aiJson.speak) aiJson.speak = `Searching Google for "${siteKey}".`;
        } else if (aiJson.tool === 'weather' && !aiJson.open) aiJson.open = "https://windy.com";
        else if (aiJson.tool === 'news' && !aiJson.open) aiJson.open = "https://reuters.com";

        if (aiJson.tool !== 'none') await executeToolCommand(aiJson);
        else {
            let replyText = aiJson.speak;
            if (!replyText || replyText.length < 2) replyText = "I'm not sure how to answer that.";
            addMessage(replyText, false);
            speakText(replyText);
        }
    } catch (error) {
        console.error(error);
        addSystemMessage(`❌ Error: ${error.message}.`, true);
        speakText("I encountered an error. Please try again.");
    } finally {
        thinkingIndicator.classList.remove('active');
    }
}

// ---------- Voice Recognition ----------
function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        addSystemMessage("❌ Voice recognition not supported.", true);
        micBtn.disabled = true;
        return null;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new SpeechRecognition();
    recog.continuous = false;
    recog.interimResults = false;
    recog.lang = 'en-US';

    recog.onstart = () => {
        isListening = true;
        micBtn.classList.add('listening');
        soundWave.classList.add('active');
        voiceStatusSpan.innerText = "🎤 Listening...";
        aiOrb.style.boxShadow = "0 0 30px #ff3399";
    };
    recog.onend = () => {
        isListening = false;
        micBtn.classList.remove('listening');
        soundWave.classList.remove('active');
        voiceStatusSpan.innerText = "";
        aiOrb.style.boxShadow = "0 0 20px cyan";
        if (continuousMode && !isSpeaking && !pendingRestart && !userInput.value.trim()) {
            pendingRestart = true;
            setTimeout(() => {
                if (continuousMode && !isListening && !isSpeaking) try { recog.start(); } catch(e) {}
                pendingRestart = false;
            }, 500);
        }
    };
    recog.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        userInput.value = transcript;
        voiceStatusSpan.innerText = `🗣️ "${transcript}"`;
        setTimeout(() => voiceStatusSpan.innerText = "", 2000);
        processUserInput(transcript);
    };
    recog.onerror = (e) => {
        voiceStatusSpan.innerText = `🎙️ ${e.error}`;
        setTimeout(() => voiceStatusSpan.innerText = "", 1500);
        micBtn.classList.remove('listening');
        soundWave.classList.remove('active');
        isListening = false;
    };
    return recog;
}

function startListening() {
    if (isSpeaking) { addSystemMessage("Zara is speaking, please wait...", false); return; }
    if (!recognition) recognition = initSpeechRecognition();
    if (!recognition) return;
    if (isListening) recognition.stop();
    else recognition.start();
}

async function processUserInput(text) {
    if (!text.trim()) return;
    addMessage(text, true);
    userInput.value = "";
    await askZara(text);
}

// ---------- Event Listeners ----------
sendBtn.addEventListener('click', () => processUserInput(userInput.value));
userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') processUserInput(userInput.value); });
micBtn.addEventListener('click', startListening);
continuousModeToggle.addEventListener('change', (e) => { continuousMode = e.target.checked; if (!continuousMode && isListening) recognition?.stop(); addSystemMessage(`Continuous mode ${continuousMode ? 'enabled' : 'disabled'}.`, false); });
saveApiKeyBtn.addEventListener('click', () => {
    let newKey = apiKeyInput.value.trim();
    if (!newKey) { addSystemMessage("❌ Empty key.", true); return; }
    if (!newKey.startsWith("sk-or-")) { addSystemMessage("❌ Invalid key format (must start with sk-or-).", true); return; }
    localStorage.setItem('zara_openrouter_key', newKey);
    openRouterApiKey = newKey;
    addSystemMessage("✅ API key saved.", false);
    speakText("Key saved.");
});

function loadChatHistory() {
    let history = JSON.parse(localStorage.getItem('zara_chat_history') || '[]');
    if (!history.length) return;
    const lastMessages = history.slice(-12);
    chatMessages.innerHTML = '';
    lastMessages.forEach(msg => renderMessage(msg.content, msg.role === 'user'));
    addSystemMessage("🔄 Loaded previous conversation.", false);
}
loadChatHistory();

setTimeout(() => {
    if (openRouterApiKey) speakText(`Zara ready. Hello ${zaraMemory.name}.`);
    else speakText("Please set your API key.");
}, 800);
