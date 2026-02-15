window.electronAPI.onLoad(setMessage);

function setMessage(event, data) {
    const p = document.querySelector("#message");
    // HTML error templates (dependency errors) start with '<' — render as HTML.
    // Runtime error strings (from sshfs stderr, user input) use textContent to prevent XSS.
    if (typeof data === 'string' && data.trimStart().startsWith('<')) {
        p.innerHTML = data;
    } else {
        p.textContent = data;
    }
}
