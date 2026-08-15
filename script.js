(function(){
  "use strict";

  /* =========================================================
     Everything below lives only in memory for this tab.
     No localStorage, no database, no login backend — the
     "login" screen is just an in-memory session label.

     SECURITY: the Groq API key is NOT here anymore. Chat/code
     requests go through your own backend proxy (see /server),
     which holds the key server-side and never sends it to the
     browser. Point this at wherever you deploy the proxy.
  ========================================================= */
  const BACKEND_URL = "http://localhost:3001"; // change to your deployed backend URL in production

  const MODES = {
    L1: { label:"Chat",  limit:50, prompt:"You are a helpful, friendly conversational assistant." },
    M2: { label:"Code",  limit:25, prompt:"You are an expert programming assistant. Provide correct, well-explained code." },
    H3: { label:"Image", limit:5,  prompt:"You help craft rich, detailed image-generation prompts. Note: this app does not generate actual images — you describe the scene in vivid detail for the user to use elsewhere." }
  };

  let state = {
    userName: "",
    chats: {},
    currentId: null,
    mode: "L1",
    modeUsage: { L1: MODES.L1.limit, M2: MODES.M2.limit, H3: MODES.H3.limit },
    model: "llama-3.3-70b-versatile",
    theme: "light",
    autoSpeak: false,
    systemPrompt: "",
    voiceName: "",
    rate: 1
  };

  function uid(){ return "id" + Date.now() + Math.random().toString(16).slice(2,8); }

  /* ---------------- DOM refs ---------------- */
  const loginScreen = document.getElementById("loginScreen");
  const loginName = document.getElementById("loginName");
  const loginBtn = document.getElementById("loginBtn");
  const appRoot = document.getElementById("appRoot");
  const greetText = document.getElementById("greetText");

  const historyList = document.getElementById("historyList");
  const messagesEl = document.getElementById("messages");
  const emptyState = document.getElementById("emptyState");
  const userInput = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");
  const micBtn = document.getElementById("micBtn");
  const attachBtn = document.getElementById("attachBtn");
  const fileInput = document.getElementById("fileInput");
  const attachChip = document.getElementById("attachChip");
  const newChatBtn = document.getElementById("newChatBtn");
  const searchInput = document.getElementById("searchInput");
  const modelSelect = document.getElementById("modelSelect");
  const themeSwitch = document.getElementById("themeSwitch");
  const autoSpeakSwitch = document.getElementById("autoSpeakSwitch");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const sidebar = document.getElementById("sidebar");
  const sidebarToggle = document.getElementById("sidebarToggle");
  const bodyRow = document.getElementById("bodyRow");
  const resizeHandle = document.getElementById("resizeHandle");
  const codePanel = document.getElementById("codePanel");
  const codePanelTitle = document.getElementById("codePanelTitle");
  const codePanelTabs = document.getElementById("codePanelTabs");
  const codePanelClose = document.getElementById("codePanelClose");
  const codeViewBtn = document.getElementById("codeViewBtn");
  const previewViewBtn = document.getElementById("previewViewBtn");
  const codeCopyBtn = document.getElementById("codeCopyBtn");
  const codePre = document.getElementById("codePre");
  const codePanelCode = document.getElementById("codePanelCode");
  const codePreviewFrame = document.getElementById("codePreviewFrame");
  const exportBtn = document.getElementById("exportBtn");
  const systemPromptInput = document.getElementById("systemPromptInput");
  const voiceSelect = document.getElementById("voiceSelect");
  const rateRange = document.getElementById("rateRange");
  const rateVal = document.getElementById("rateVal");
  const charCount = document.getElementById("charCount");
  const composerControls = document.getElementById("composerControls");
  const activeIndicator = document.getElementById("activeIndicator");

  let pendingAttachment = null;
  let isGenerating = false;
  let abortController = null;
  let searchTerm = "";
  let availableVoices = [];

  /* ---------------- Login ---------------- */
  function doLogin(){
    const name = loginName.value.trim() || "Guest";
    state.userName = name;
    greetText.textContent = "Hi, " + name;
    loginScreen.style.display = "none";
    appRoot.style.display = "grid";
    init();
  }
  loginBtn.addEventListener("click", doLogin);
  loginName.addEventListener("keydown", (e)=>{ if(e.key === "Enter") doLogin(); });

  /* ---------------- Init (runs after login) ---------------- */
  function init(){
    document.documentElement.setAttribute("data-theme", state.theme);
    themeSwitch.checked = state.theme === "dark";
    modelSelect.value = state.model;
    loadVoices();
    createNewChat(false);
    renderSidebar();
    renderMessages();
    renderComposerControls();
  }

  /* ---------------- Voices ---------------- */
  function loadVoices(){
    const populate = () => {
      availableVoices = speechSynthesis.getVoices();
      voiceSelect.innerHTML = '<option value="">System default</option>';
      availableVoices.forEach(v=>{
        const opt = document.createElement("option");
        opt.value = v.name;
        opt.textContent = `${v.name} (${v.lang})`;
        if(v.name === state.voiceName) opt.selected = true;
        voiceSelect.appendChild(opt);
      });
    };
    populate();
    if("onvoiceschanged" in speechSynthesis){ speechSynthesis.onvoiceschanged = populate; }
  }

  /* ---------------- Composer: mode chips with quotas ---------------- */
  function renderComposerControls(){
    composerControls.innerHTML = "";
    Object.keys(MODES).forEach(key=>{
      const remaining = state.modeUsage[key];
      const exhausted = remaining <= 0;
      const chip = document.createElement("div");
      chip.className = "mode-chip" + (state.mode === key ? " active" : "") + (exhausted ? " exhausted" : "");
      chip.title = exhausted ? "Limit reached for this session" : `${MODES[key].label} mode`;
      chip.innerHTML = `<span>${key} · ${MODES[key].label}</span><span class="badge-count">${remaining}</span>`;
      chip.addEventListener("click", ()=>{
        if(exhausted){ showToast(`${MODES[key].label} mode's limit is used up for this session`); return; }
        state.mode = key;
        renderComposerControls();
      });
      composerControls.appendChild(chip);
    });
    const m = MODES[state.mode];
    activeIndicator.textContent = `${m.label} mode · ${state.modeUsage[state.mode]} messages left this session`;

    const placeholders = { L1:"Ask anything...", M2:"Describe the coding problem...", H3:"Describe the image you want..." };
    userInput.placeholder = placeholders[state.mode];
  }

  /* ---------------- Chat management ---------------- */
  function createNewChat(render){
    const id = uid();
    state.chats[id] = { id, title:"New chat", model: state.model, messages: [] };
    state.currentId = id;
    if(render !== false){ renderSidebar(); renderMessages(); }
    userInput.focus();
  }
  function selectChat(id){ state.currentId = id; renderSidebar(); renderMessages(); }
  function deleteChat(id, ev){
    ev.stopPropagation();
    delete state.chats[id];
    const ids = Object.keys(state.chats);
    if(state.currentId === id){
      state.currentId = ids.length ? ids[ids.length-1] : null;
      if(!state.currentId) createNewChat(false);
    }
    renderSidebar(); renderMessages();
  }
  function currentChat(){ return state.chats[state.currentId]; }

  function renderSidebar(){
    historyList.innerHTML = "";
    let ids = Object.keys(state.chats).sort((a,b)=>{
      const ma = state.chats[a].messages.at(-1)?.ts || 0;
      const mb = state.chats[b].messages.at(-1)?.ts || 0;
      return mb - ma;
    });
    if(searchTerm){
      ids = ids.filter(id => (state.chats[id].title||"").toLowerCase().includes(searchTerm) ||
        state.chats[id].messages.some(m => m.content.toLowerCase().includes(searchTerm)));
    }
    ids.forEach(id=>{
      const chat = state.chats[id];
      const item = document.createElement("div");
      item.className = "history-item" + (id === state.currentId ? " active" : "");
      item.innerHTML = `<span>💬</span><span class="title">${escapeHtml(chat.title || "New chat")}</span>
        <span class="row-btns">
          <button class="export-btn" title="Export">⬇</button>
          <button class="del-btn" title="Delete">✕</button>
        </span>`;
      item.addEventListener("click", ()=>selectChat(id));
      item.querySelector(".del-btn").addEventListener("click", (ev)=>deleteChat(id, ev));
      item.querySelector(".export-btn").addEventListener("click", (ev)=>{ ev.stopPropagation(); exportChat(chat); });
      historyList.appendChild(item);
    });
  }

  function renderMessages(){
    messagesEl.innerHTML = "";
    const chat = currentChat();
    if(!chat || chat.messages.length === 0){ messagesEl.appendChild(emptyState); return; }
    chat.messages.forEach(m => messagesEl.appendChild(buildMessageEl(m)));
    scrollToBottom();
  }
  function scrollToBottom(){ messagesEl.scrollTop = messagesEl.scrollHeight; }
  function escapeHtml(str){ const d = document.createElement("div"); d.textContent = str; return d.innerHTML; }
  function timeLabel(ts){ return new Date(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}); }

  /* ---------------- Code block extraction (for the Claude-style side panel) ---------------- */
  function extractCodeBlocks(content){
    const regex = /```(\w+)?\n?([\s\S]*?)```/g;
    const blocks = [];
    let match;
    while((match = regex.exec(content))){
      blocks.push({ lang: (match[1] || "plaintext").toLowerCase(), code: match[2].replace(/\n$/, "") });
    }
    return blocks;
  }

  function renderRichContent(content){
    const frag = document.createDocumentFragment();
    const regex = /```(\w+)?\n?([\s\S]*?)```/g;
    let lastIndex = 0, match, blocks = [];
    while((match = regex.exec(content))){
      if(match.index > lastIndex){
        const textPart = content.slice(lastIndex, match.index);
        if(textPart.trim()) frag.appendChild(document.createTextNode(textPart));
      }
      const lang = (match[1] || "plaintext").toLowerCase();
      const code = match[2].replace(/\n$/, "");
      blocks.push({ lang, code });
      const bIdx = blocks.length - 1;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "code-chip";
      btn.innerHTML = `📄 ${escapeHtml(lang)} snippet — view`;
      btn.addEventListener("click", ()=> openCodePanel(blocks, bIdx));
      frag.appendChild(btn);
      lastIndex = regex.lastIndex;
    }
    if(lastIndex < content.length){
      const rest = content.slice(lastIndex);
      if(rest.trim()) frag.appendChild(document.createTextNode(rest));
    }
    return { frag, blocks };
  }

  function buildMessageEl(m){
    const row = document.createElement("div");
    row.className = "msg-row " + (m.role === "user" ? "user" : "ai");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = m.role === "user" ? "🙂" : "🌲";

    const body = document.createElement("div");
    body.className = "msg-body";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if(m.type === "image"){
      bubble.classList.add("image-bubble");
      const img = document.createElement("img");
      img.src = m.imageUrl;
      img.alt = m.content;
      img.className = "gen-image";
      bubble.appendChild(img);
    } else {
      const { frag } = renderRichContent(m.content);
      bubble.appendChild(frag);
    }

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = timeLabel(m.ts);

    body.appendChild(bubble);
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "msg-actions";
    const copyPayload = m.type === "image" ? m.imageUrl : m.content;

    if(m.role === "assistant"){
      actions.innerHTML = m.type === "image" ? `
        <button class="icon-btn speak-btn" title="Read prompt aloud">🔊</button>
        <button class="icon-btn copy-btn" title="Copy image link">📋</button>
        <button class="icon-btn dl-btn" title="Download image">⬇</button>
        <button class="icon-btn regen-btn" title="Regenerate image">↻</button>` : `
        <button class="icon-btn speak-btn" title="Read aloud">🔊</button>
        <button class="icon-btn copy-btn" title="Copy">📋</button>
        <button class="icon-btn regen-btn" title="Regenerate">↻</button>`;
      actions.querySelector(".speak-btn").addEventListener("click", (e)=> speakText(m.content, e.currentTarget));
      actions.querySelector(".copy-btn").addEventListener("click", (e)=> copyText(copyPayload, e.currentTarget));
      actions.querySelector(".regen-btn").addEventListener("click", ()=> regenerate(m));
      if(m.type === "image"){
        actions.querySelector(".dl-btn").addEventListener("click", ()=>{
          const a = document.createElement("a");
          a.href = m.imageUrl;
          a.download = "sylvaai-image.jpg";
          a.target = "_blank";
          a.rel = "noopener";
          a.click();
        });
      }
    } else {
      actions.innerHTML = `
        <button class="icon-btn edit-btn" title="Edit & resend">✏</button>
        <button class="icon-btn copy-btn" title="Copy">📋</button>`;
      actions.querySelector(".edit-btn").addEventListener("click", ()=> editMessage(m));
      actions.querySelector(".copy-btn").addEventListener("click", (e)=> copyText(m.content, e.currentTarget));
    }
    body.appendChild(actions);

    row.appendChild(avatar);
    row.appendChild(body);
    return row;
  }

  function editMessage(userMsg){
    const chat = currentChat();
    const idx = chat.messages.indexOf(userMsg);
    if(idx === -1) return;
    userInput.value = userMsg.content;
    chat.messages.splice(idx);
    renderMessages();
    autoResizeInput();
    userInput.focus();
    showToast("Message loaded for editing — resend when ready");
  }

  /* ---------------- Sending messages ---------------- */
  async function sendMessage(){
    const text = userInput.value.trim();
    if(!text && !pendingAttachment) return;

    if(state.modeUsage[state.mode] <= 0){
      showToast(`${MODES[state.mode].label} mode's limit is used up for this session — switch modes`);
      return;
    }

    const chat = currentChat();
    let content = text;
    if(pendingAttachment){
      content += (content ? "\n\n" : "") + `[Attached file: ${pendingAttachment.name}]`;
      pendingAttachment = null;
      attachChip.classList.add("d-none");
      attachChip.textContent = "";
    }

    chat.messages.push({ role:"user", content, ts: Date.now(), mode: state.mode });
    if(chat.title === "New chat"){ chat.title = text.slice(0,40) || "New chat"; }
    state.modeUsage[state.mode]--;
    renderComposerControls();

    userInput.value = "";
    autoResizeInput();
    updateCharCount();
    renderSidebar();
    renderMessages();

    if(state.mode === "H3"){ await generateImage(chat); }
    else{ await requestCompletion(chat); }
  }

  function showTypingIndicator(){
    const row = document.createElement("div");
    row.className = "msg-row ai";
    row.id = "typingRow";
    row.innerHTML = `<div class="avatar">🌲</div><div class="msg-body"><div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div></div>`;
    messagesEl.appendChild(row);
    scrollToBottom();
  }
  function removeTypingIndicator(){ document.getElementById("typingRow")?.remove(); }

  function setGenerating(on){
    isGenerating = on;
    sendBtn.classList.toggle("stop", on);
    sendBtn.textContent = on ? "⏹" : "➤";
    sendBtn.title = on ? "Stop generating" : "Send";
  }

  async function requestCompletion(chat){
    showTypingIndicator();
    setGenerating(true);
    abortController = new AbortController();

    const payloadMessages = [];
    const modePrompt = MODES[state.mode].prompt;
    const persona = state.systemPrompt && state.systemPrompt.trim() ? state.systemPrompt.trim() + " " : "";
    payloadMessages.push({ role:"system", content: persona + modePrompt });
    chat.messages.slice(-20).forEach(m => payloadMessages.push({ role:m.role, content:m.content }));

    try{
      const res = await fetch(BACKEND_URL + "/api/chat", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          model: state.model,
          messages: payloadMessages,
          temperature: 0.7
        }),
        signal: abortController.signal
      });

      removeTypingIndicator();
      if(!res.ok){
        const errBody = await res.text();
        throw new Error(`API error ${res.status}: ${errBody.slice(0,200)}`);
      }
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content || "(No response received.)";
      chat.messages.push({ role:"assistant", content: reply, ts: Date.now() });
      renderMessages();
      if(state.autoSpeak){ speakText(reply, null); }
      const blocks = extractCodeBlocks(reply);
      if(blocks.length){ openCodePanel(blocks, 0); }
    }catch(err){
      removeTypingIndicator();
      if(err.name === "AbortError"){
        showToast("Generation stopped");
      } else {
        chat.messages.push({ role:"assistant", content:"⚠ Couldn't reach the API: " + err.message, ts: Date.now() });
        renderMessages();
      }
    }finally{
      setGenerating(false);
      abortController = null;
    }
  }

  function regenerate(assistantMsg){
    const chat = currentChat();
    const idx = chat.messages.indexOf(assistantMsg);
    if(idx === -1) return;
    chat.messages.splice(idx, 1);
    renderMessages();
    if(assistantMsg.type === "image"){ generateImage(chat, assistantMsg.content); }
    else{ requestCompletion(chat); }
  }

  /* ---------------- Image generation (Pollinations — free, no key) ---------------- */
  function preloadImage(url){
    return new Promise((resolve, reject)=>{
      const img = new Image();
      const timer = setTimeout(()=> reject(new Error("Timed out waiting for the image")), 30000);
      img.onload = ()=>{ clearTimeout(timer); resolve(); };
      img.onerror = ()=>{ clearTimeout(timer); reject(new Error("Image generation failed")); };
      img.src = url;
    });
  }

  async function generateImage(chat, promptOverride){
    const promptText = promptOverride || chat.messages.at(-1).content;
    showTypingIndicator();
    setGenerating(true);

    const seed = Math.floor(Math.random() * 1000000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptText)}?width=768&height=768&seed=${seed}&nologo=true`;

    try{
      await preloadImage(url);
      removeTypingIndicator();
      chat.messages.push({ role:"assistant", type:"image", content: promptText, imageUrl: url, ts: Date.now() });
      renderMessages();
    }catch(err){
      removeTypingIndicator();
      chat.messages.push({ role:"assistant", content:"⚠ Couldn't generate that image (" + err.message + "). Try again or simplify the prompt.", ts: Date.now() });
      renderMessages();
    }finally{
      setGenerating(false);
    }
  }

  /* ---------------- Export ---------------- */
  function exportChat(chat){
    const lines = chat.messages.map(m => `[${timeLabel(m.ts)}] ${m.role === "user" ? "You" : "PromptGPT"}: ${m.content}`);
    const blob = new Blob([lines.join("\n\n")], { type:"text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (chat.title || "sylva-chat").replace(/[^\w\- ]+/g,"").slice(0,50) + ".txt";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Chat exported");
  }
  exportBtn.addEventListener("click", ()=>{
    const chat = currentChat();
    if(chat && chat.messages.length) exportChat(chat);
    else showToast("Nothing to export yet");
  });

  /* ---------------- Voice: read aloud ---------------- */
  function speakText(text, btn){
    if(!("speechSynthesis" in window)){ showToast("Speech synthesis isn't supported here"); return; }
    if(speechSynthesis.speaking){
      speechSynthesis.cancel();
      document.querySelectorAll(".speak-btn.active").forEach(b=>b.classList.remove("active"));
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = state.rate || 1;
    utter.pitch = 1;
    if(state.voiceName){
      const v = availableVoices.find(v => v.name === state.voiceName);
      if(v) utter.voice = v;
    }
    if(btn) btn.classList.add("active");
    utter.onend = () => { if(btn) btn.classList.remove("active"); };
    speechSynthesis.speak(utter);
  }

  /* ---------------- Copy ---------------- */
  function copyText(text, btn){
    navigator.clipboard.writeText(text).then(()=>{
      const original = btn.textContent;
      btn.textContent = "✓";
      setTimeout(()=> btn.textContent = original, 1200);
    });
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function showToast(msg){
    let el = document.querySelector(".toast-msg");
    if(!el){ el = document.createElement("div"); el.className="toast-msg"; document.body.appendChild(el); }
    el.textContent = msg;
    requestAnimationFrame(()=> el.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=> el.classList.remove("show"), 2000);
  }

  /* ---------------- Voice: mic input ---------------- */
  let recognition = null, recording = false;
  function initSpeechRecognition(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return null;
    const r = new SR();
    r.continuous = false; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e)=>{
      let transcript = "";
      for(let i=0;i<e.results.length;i++) transcript += e.results[i][0].transcript;
      userInput.value = transcript;
      autoResizeInput(); updateCharCount();
    };
    r.onend = ()=>{ recording = false; micBtn.classList.remove("recording"); };
    r.onerror = ()=>{ recording = false; micBtn.classList.remove("recording"); };
    return r;
  }
  micBtn.addEventListener("click", ()=>{
    if(!recognition) recognition = initSpeechRecognition();
    if(!recognition){ showToast("Voice input isn't supported — try Chrome"); return; }
    if(recording){ recognition.stop(); recording = false; micBtn.classList.remove("recording"); }
    else{ recognition.start(); recording = true; micBtn.classList.add("recording"); }
  });

  /* ---------------- Attachments (display-only) ---------------- */
  attachBtn.addEventListener("click", ()=> fileInput.click());
  fileInput.addEventListener("change", ()=>{
    if(fileInput.files.length){
      pendingAttachment = fileInput.files[0];
      attachChip.textContent = "📎 " + pendingAttachment.name;
      attachChip.classList.remove("d-none");
    }
  });

  /* ---------------- Input handling ---------------- */
  function autoResizeInput(){
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 140) + "px";
  }
  function updateCharCount(){ charCount.textContent = userInput.value.length + " chars"; }
  userInput.addEventListener("input", ()=>{ autoResizeInput(); updateCharCount(); });
  userInput.addEventListener("keydown", (e)=>{
    if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); sendMessage(); }
  });
  sendBtn.addEventListener("click", ()=>{
    if(isGenerating){ abortController?.abort(); }
    else{ sendMessage(); }
  });
  newChatBtn.addEventListener("click", ()=> createNewChat(true));
  searchInput.addEventListener("input", ()=>{ searchTerm = searchInput.value.trim().toLowerCase(); renderSidebar(); });

  /* ---------------- Settings ---------------- */
  themeSwitch.addEventListener("change", ()=>{
    document.documentElement.setAttribute("data-theme", themeSwitch.checked ? "dark" : "light");
  });
  rateRange.addEventListener("input", ()=> rateVal.textContent = parseFloat(rateRange.value).toFixed(1) + "x");
  modelSelect.addEventListener("change", ()=>{
    state.model = modelSelect.value;
    const chat = currentChat();
    if(chat) chat.model = modelSelect.value;
  });

  saveSettingsBtn.addEventListener("click", ()=>{
    state.theme = themeSwitch.checked ? "dark" : "light";
    state.autoSpeak = autoSpeakSwitch.checked;
    state.systemPrompt = systemPromptInput.value;
    state.voiceName = voiceSelect.value;
    state.rate = parseFloat(rateRange.value);
    document.documentElement.setAttribute("data-theme", state.theme);
    showToast("Settings saved for this session");
  });

  sidebarToggle?.addEventListener("click", ()=> sidebar.classList.toggle("open"));

  /* ---------------- Sidebar resize ---------------- */
  let resizing = false;
  resizeHandle.addEventListener("mousedown", (e)=>{
    resizing = true;
    resizeHandle.classList.add("dragging");
    bodyRow.classList.add("resizing");
    document.body.style.userSelect = "none";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e)=>{
    if(!resizing) return;
    const w = Math.min(420, Math.max(190, e.clientX));
    document.documentElement.style.setProperty("--sidebar-w", w + "px");
  });
  document.addEventListener("mouseup", ()=>{
    if(!resizing) return;
    resizing = false;
    resizeHandle.classList.remove("dragging");
    bodyRow.classList.remove("resizing");
    document.body.style.userSelect = "";
  });

  /* ---------------- Code panel (Claude-style side view) ---------------- */
  let codePanelBlocks = [];
  let codePanelActiveIndex = 0;
  let codePanelMode = "code"; // "code" | "preview"

  function openCodePanel(blocks, index){
    codePanelBlocks = blocks;
    codePanelActiveIndex = index || 0;
    codePanelMode = "code";
    bodyRow.classList.add("with-code");
    renderCodePanel();
  }
  function closeCodePanel(){ bodyRow.classList.remove("with-code"); }

  function renderCodePanel(){
    const block = codePanelBlocks[codePanelActiveIndex];
    if(!block) return;

    codePanelTitle.textContent = block.lang;

    // Tabs (only shown when there's more than one block in this message)
    codePanelTabs.innerHTML = "";
    if(codePanelBlocks.length > 1){
      codePanelTabs.classList.remove("d-none");
      codePanelBlocks.forEach((b, i)=>{
        const tab = document.createElement("button");
        tab.className = "code-tab" + (i === codePanelActiveIndex ? " active" : "");
        tab.textContent = `${b.lang} ${i+1}`;
        tab.addEventListener("click", ()=>{ codePanelActiveIndex = i; codePanelMode = "code"; renderCodePanel(); });
        codePanelTabs.appendChild(tab);
      });
    } else {
      codePanelTabs.classList.add("d-none");
    }

    // Preview toggle only makes sense for html
    const isHtml = block.lang === "html";
    previewViewBtn.classList.toggle("d-none", !isHtml);

    codeViewBtn.classList.toggle("active", codePanelMode === "code");
    previewViewBtn.classList.toggle("active", codePanelMode === "preview");

    if(codePanelMode === "preview" && isHtml){
      codePre.classList.add("d-none");
      codePreviewFrame.classList.remove("d-none");
      codePreviewFrame.srcdoc = block.code;
    } else {
      codePreviewFrame.classList.add("d-none");
      codePre.classList.remove("d-none");
      codePanelCode.className = "hljs language-" + block.lang;
      codePanelCode.textContent = block.code;
      if(window.hljs){
        try{ hljs.highlightElement(codePanelCode); }catch(e){}
      }
    }
  }

  codeViewBtn.addEventListener("click", ()=>{ codePanelMode = "code"; renderCodePanel(); });
  previewViewBtn.addEventListener("click", ()=>{ codePanelMode = "preview"; renderCodePanel(); });
  codePanelClose.addEventListener("click", closeCodePanel);
  codeCopyBtn.addEventListener("click", ()=>{
    const block = codePanelBlocks[codePanelActiveIndex];
    if(!block) return;
    navigator.clipboard.writeText(block.code).then(()=> showToast("Code copied"));
  });

  /* init() is called after login, not here */
})();
