const form = document.querySelector('#settings');

window.electronAPI.onLoad((event, defaults) => {
    if (defaults.mountroot) form.querySelector('input[name="mountroot"]').value = defaults.mountroot;
    if (defaults.identity) form.querySelector('input[name="identity"]').value = defaults.identity;
    if (defaults.port) form.querySelector('input[name="port"]').value = defaults.port;
    if (defaults.sshoptions) form.querySelector('input[name="sshoptions"]').value = defaults.sshoptions;
    fitWindow();
});

function fitWindow() {
    setTimeout(() => {
        const rect = form.getBoundingClientRect();
        const bodyStyle = getComputedStyle(document.body);
        const bodyMargin = parseInt(bodyStyle.marginTop) + parseInt(bodyStyle.marginBottom);
        window.electronAPI.resizeToContent(Math.ceil(rect.height + bodyMargin + form.offsetTop));
    }, 0);
}

form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = {
        mountroot: form.querySelector('input[name="mountroot"]').value || '',
        identity: form.querySelector('input[name="identity"]').value || '',
        port: form.querySelector('input[name="port"]').value || '',
        sshoptions: form.querySelector('input[name="sshoptions"]').value || '',
    };
    window.electronAPI.sendSettings(data);
    window.close();
});

fitWindow();
