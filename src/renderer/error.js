window.electronAPI.onLoad(setMessage);

function setMessage(event, data) {
    const p = document.querySelector("#message");
    if (data && typeof data === 'object' && data.html) {
        p.innerHTML = data.content;
    } else {
        p.textContent = typeof data === 'string' ? data : String(data);
    }
}
