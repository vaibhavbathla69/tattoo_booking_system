/* Black Craft Custom Tattoos — owner chat */

let token = sessionStorage.getItem("owner_token");
const history = []; // [{role, content}]

const $ = (id) => document.getElementById(id);

function showChat() {
  $("login-view").hidden = true;
  $("chat-wrap").hidden = false;
  addMsg("assistant", "Morning. Ask me about the schedule, clients, or tell me to add a booking.");
  $("input").focus();
}

function addMsg(role, text, extraClass = "") {
  const div = document.createElement("div");
  div.className = `msg ${role} ${extraClass}`.trim();
  div.textContent = text;
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
  return div;
}

// ---------- login ----------

async function login() {
  const err = $("login-error");
  err.hidden = true;
  try {
    const res = await fetch("/api/owner/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("password").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed.");
    token = data.token;
    sessionStorage.setItem("owner_token", token);
    showChat();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

$("login-btn").addEventListener("click", login);
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

// ---------- chat ----------

let busy = false;

async function send(text) {
  const message = (text || $("input").value).trim();
  if (!message || busy) return;
  busy = true;
  $("input").value = "";
  $("input").style.height = "auto";
  $("suggestions").style.display = "none";

  addMsg("user", message);
  const pending = addMsg("assistant", "Thinking…", "thinking");

  try {
    const res = await fetch("/api/owner/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ history, message }),
    });
    const data = await res.json();

    if (res.status === 401) {
      sessionStorage.removeItem("owner_token");
      pending.remove();
      addMsg("assistant", "Session expired — refresh the page and log in again.", "error");
      return;
    }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");

    pending.classList.remove("thinking");
    pending.textContent = data.reply;
    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: data.reply });
  } catch (e) {
    pending.classList.remove("thinking");
    pending.classList.add("error");
    pending.textContent = e.message;
  } finally {
    busy = false;
    $("messages").scrollTop = $("messages").scrollHeight;
    $("input").focus();
  }
}

$("send-btn").addEventListener("click", () => send());
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$("input").addEventListener("input", (e) => {
  e.target.style.height = "auto";
  e.target.style.height = Math.min(e.target.scrollHeight, 130) + "px";
});
$("suggestions").addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") send(e.target.textContent);
});

// If we already have a token from this browser session, try it
if (token) showChat();
