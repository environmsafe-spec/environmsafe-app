/**
 * EnvironmSafe agent console.
 *
 * Talks to /api/agent, which runs the agent loop server-side and streams back
 * text, reasoning summaries and tool activity as server-sent events. No API
 * keys and no business logic live in this file.
 */
(function () {
  "use strict";

  var gate = document.getElementById("gate");
  var gateForm = document.getElementById("gate-form");
  var gateError = document.getElementById("gate-error");
  var passcode = document.getElementById("passcode");
  var shell = document.getElementById("shell");
  var transcript = document.getElementById("transcript");
  var welcome = document.getElementById("welcome");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");

  /** Conversation as the API expects it: {role, content}. */
  var history = [];
  var busy = false;

  /* ------------------------------------------------------------ sign in -- */

  fetch("/api/login")
    .then(function (r) { return r.json(); })
    .then(function (data) { if (data.signedIn) showConsole(); })
    .catch(function () { /* stay on the gate */ });

  gateForm.addEventListener("submit", function (event) {
    event.preventDefault();
    gateError.textContent = "";

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: passcode.value }),
    })
      .then(function (response) {
        if (response.ok) { showConsole(); return null; }
        return response.json().then(function (data) {
          gateError.textContent = data.error || "Sign in failed.";
          passcode.value = "";
        });
      })
      .catch(function () { gateError.textContent = "Could not reach the server."; });
  });

  function showConsole() {
    gate.style.display = "none";
    shell.classList.add("is-active");
    input.focus();
  }

  document.getElementById("btn-signout").addEventListener("click", function () {
    fetch("/api/login", { method: "DELETE" }).then(function () { location.reload(); });
  });

  document.getElementById("btn-new").addEventListener("click", function () {
    history = [];
    transcript.innerHTML = "";
    transcript.appendChild(welcome);
    welcome.style.display = "";
    input.focus();
  });

  /* ------------------------------------------------------------ sending -- */

  Array.prototype.forEach.call(document.querySelectorAll(".starter"), function (button) {
    button.addEventListener("click", function () {
      input.value = button.getAttribute("data-prompt");
      submit();
    });
  });

  sendBtn.addEventListener("click", submit);

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });

  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
  });

  function submit() {
    var text = input.value.trim();
    if (!text || busy) return;

    welcome.style.display = "none";
    input.value = "";
    input.style.height = "auto";
    addMessage("user", text);
    history.push({ role: "user", content: text });
    run();
  }

  function run() {
    busy = true;
    sendBtn.disabled = true;

    var agentBody = addMessage("agent", "");
    var activity = null;
    var thinkingEl = null;
    var answer = "";

    fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    })
      .then(function (response) {
        if (response.status === 401) { location.reload(); return; }
        if (!response.ok || !response.body) throw new Error("The agent is not responding.");
        return readStream(response.body, onEvent);
      })
      .catch(function (error) { showError(error.message); })
      .then(finish, finish);

    function onEvent(event, data) {
      if (event === "text") {
        if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
        answer += data.delta;
        agentBody.innerHTML = renderMarkdown(answer);
        scroll();
      } else if (event === "thinking") {
        if (!thinkingEl) {
          thinkingEl = document.createElement("div");
          thinkingEl.className = "thinking";
          agentBody.appendChild(thinkingEl);
        }
        thinkingEl.textContent += data.delta;
        scroll();
      } else if (event === "tool") {
        if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
        if (!activity) {
          activity = document.createElement("div");
          activity.className = "activity";
          agentBody.appendChild(activity);
        }
        activity.appendChild(activityItem(data.name, data.input));
        scroll();
      } else if (event === "tool_done") {
        var pending = activity &&
          activity.querySelector(".activity__item:not(.is-done):not(.is-failed)");
        if (pending) {
          pending.classList.add(data.ok ? "is-done" : "is-failed");
          pending.querySelector("i").className = data.ok
            ? "fa-solid fa-circle-check"
            : "fa-solid fa-circle-exclamation";
        }
      } else if (event === "done") {
        history = history.concat(data.messages.slice(1));
      } else if (event === "error") {
        showError(data.message);
      }
    }

    function showError(message) {
      var note = document.createElement("div");
      note.className = "error-note";
      note.textContent = message;
      agentBody.appendChild(note);
      scroll();
    }

    function finish() {
      if (thinkingEl) thinkingEl.remove();
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  /* ------------------------------------------------------------- stream -- */

  function readStream(body, onEvent) {
    var reader = body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";

    return reader.read().then(function step(result) {
      if (result.done) return;
      buffer += decoder.decode(result.value, { stream: true });

      var chunks = buffer.split("\n\n");
      buffer = chunks.pop();

      chunks.forEach(function (chunk) {
        var name = "";
        var payload = "";
        chunk.split("\n").forEach(function (line) {
          if (line.indexOf("event: ") === 0) name = line.slice(7);
          else if (line.indexOf("data: ") === 0) payload += line.slice(6);
        });
        if (!name || !payload) return;
        try { onEvent(name, JSON.parse(payload)); } catch (e) { /* skip bad frame */ }
      });

      return reader.read().then(step);
    });
  }

  /* --------------------------------------------------------------- view -- */

  function addMessage(role, text) {
    var wrap = document.createElement("div");
    wrap.className = "msg msg--" + role;

    var avatar = document.createElement("div");
    avatar.className = "msg__avatar";
    avatar.textContent = role === "user" ? "You" : "ES";

    var bodyEl = document.createElement("div");
    bodyEl.className = "msg__body";
    if (text) bodyEl.innerHTML = renderMarkdown(text);

    wrap.appendChild(avatar);
    wrap.appendChild(bodyEl);
    transcript.appendChild(wrap);
    scroll();
    return bodyEl;
  }

  function activityItem(name, args) {
    var labels = {
      drive_search: "Searching Drive",
      drive_read: "Reading document",
      drive_save: "Saving to Drive",
      create_document: "Creating document",
      sheet_read: "Reading ledger",
      sheet_append: "Updating ledger",
      gmail_search: "Searching email",
      gmail_read: "Reading email",
      gmail_draft: "Preparing draft",
    };

    var item = document.createElement("div");
    item.className = "activity__item";

    var icon = document.createElement("i");
    icon.className = "fa-solid fa-spinner fa-spin";

    var label = document.createElement("span");
    label.textContent = labels[name] || name;

    var detail = document.createElement("code");
    var hint = args &&
      (args.query || args.folder || args.name || args.number || args.to || args.range);
    detail.textContent = hint ? String(hint) : "";

    item.appendChild(icon);
    item.appendChild(label);
    if (detail.textContent) item.appendChild(detail);
    return item;
  }

  function scroll() {
    transcript.scrollTop = transcript.scrollHeight;
  }

  /**
   * Small markdown renderer. Escapes first, then adds formatting, so nothing
   * the model or a source document produces can inject markup into the page.
   */
  function renderMarkdown(text) {
    var html = text
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    var blocks = [];
    html = html.replace(/```([\s\S]*?)```/g, function (_, code) {
      blocks.push("<pre><code>" + code.replace(/^\n/, "") + "</code></pre>");
      return "@@ESBLOCK" + (blocks.length - 1) + "@@";
    });

    html = html
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');

    html = html
      .split(/\n{2,}/)
      .map(function (para) {
        var lines = para.split("\n");
        if (/^@@ESBLOCK\d+@@$/.test(para.trim())) return para;
        if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l); })) {
          return "<ul>" + lines.map(function (l) {
            return "<li>" + l.replace(/^\s*[-*]\s+/, "") + "</li>";
          }).join("") + "</ul>";
        }
        if (lines.every(function (l) { return /^\s*\d+[.)]\s+/.test(l); })) {
          return "<ol>" + lines.map(function (l) {
            return "<li>" + l.replace(/^\s*\d+[.)]\s+/, "") + "</li>";
          }).join("") + "</ol>";
        }
        return "<p>" + lines.join("<br>") + "</p>";
      })
      .join("");

    return html.replace(/@@ESBLOCK(\d+)@@/g, function (_, i) { return blocks[i]; });
  }
})();
