const form = document.querySelector("#add");
const authSelect = form.querySelector('select[name="authType"]');
const passwordRow = document.querySelector('#password-row');
const passwordInput = form.querySelector('input[name="password"]');
const autoconnectCheckbox = form.querySelector('input[name="autoconnect"]');
const statusMessage = document.querySelector('#status-message');
const testBtn = document.querySelector('#test-btn');
const mountInput = form.querySelector('input[name="mount"]');

let mountRoot = '~/sshfs_mounts';
let mountManuallyEdited = false;

window.electronAPI.onLoad((event, defaults) => {
    if (defaults.mountroot) mountRoot = defaults.mountroot;
    if (defaults.mountroot) mountInput.value = defaults.mountroot;
    if (defaults.identity) form.querySelector('input[name="identityFile"]').value = defaults.identity;
    if (defaults.sshoptions) form.querySelector('input[name="sshOptions"]').value = defaults.sshoptions;
    if (defaults.port) form.querySelector('input[name="port"]').value = defaults.port;
});

mountInput.addEventListener('input', () => {
    mountManuallyEdited = true;
});

function fitWindow() {
    // Use setTimeout to let the DOM settle after changes
    setTimeout(() => {
        const rect = form.getBoundingClientRect();
        const bodyStyle = getComputedStyle(document.body);
        const bodyMargin = parseInt(bodyStyle.marginTop) + parseInt(bodyStyle.marginBottom);
        window.electronAPI.resizeToContent(Math.ceil(rect.height + bodyMargin + form.offsetTop));
    }, 0);
}

authSelect.addEventListener('change', () => {
    const isPassword = authSelect.value === 'password';
    passwordRow.style.display = isPassword ? '' : 'none';
    passwordInput.required = isPassword;
    fitWindow();
});

function getFormData() {
    return {
        name: form.querySelector('input[name="name"]').value,
        url: form.querySelector('input[name="url"]').value,
        mount: form.querySelector('input[name="mount"]').value,
        port: form.querySelector('input[name="port"]').value || '',
        identityFile: form.querySelector('input[name="identityFile"]').value || '',
        sshOptions: form.querySelector('input[name="sshOptions"]').value || '',
        authType: authSelect.value,
        password: passwordInput.value || null,
        autoconnect: autoconnectCheckbox.checked,
    };
}

function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = type;
    fitWindow();
}

function clearStatus() {
    statusMessage.textContent = '';
    statusMessage.className = '';
    fitWindow();
}

function validatePort(port) {
    if (!port) return true;
    const p = parseInt(port, 10);
    return !isNaN(p) && p >= 1 && p <= 65535 && String(p) === port;
}

function generateMountPath(url) {
    const colonIdx = url.indexOf(':');
    const userHost = colonIdx !== -1 ? url.substring(0, colonIdx) : url;
    const remotePath = colonIdx !== -1 ? url.substring(colonIdx + 1) : '';
    const pathParts = remotePath.split('/').filter(Boolean);
    const lastPart = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '';
    const dirName = lastPart ? `${userHost}_${lastPart}` : userHost;
    const safeName = dirName.replace(/@/g, '_at_').replace(/[\/\\:*?"<>|]/g, '_');
    return mountRoot + '/' + safeName;
}

function updateMountFromURL() {
    if (mountManuallyEdited) return;
    const url = urlInput.value.trim();
    if (url && url.includes('@')) {
        mountInput.value = generateMountPath(url);
    }
}

const urlInput = form.querySelector('input[name="url"]');
urlInput.addEventListener('input', updateMountFromURL);
urlInput.addEventListener('paste', () => {
    setTimeout(() => {
        const val = urlInput.value;
        if (val.startsWith('ssh ') || val.startsWith('scp ') ||
            (val.includes('@') && (val.includes(' -p ') || val.includes(' -i ')))) {
            const parsed = parseSSHString(val);
            if (parsed) {
                urlInput.value = parsed.host;
                if (parsed.port) form.querySelector('input[name="port"]').value = parsed.port;
                if (parsed.identityFile) form.querySelector('input[name="identityFile"]').value = parsed.identityFile;
                if (parsed.options.length) {
                    form.querySelector('input[name="sshOptions"]').value = parsed.options.join(' ');
                }
                showStatus('Parsed SSH command — fields auto-filled', 'success');
            }
        }
        updateMountFromURL();
    }, 0);
});

form.addEventListener('submit', async function sendAddDataAndCloseWindow(event) {
    event.preventDefault();
    clearStatus();
    const data = getFormData();

    if (data.port && !validatePort(data.port)) {
        showStatus('Port must be a number between 1 and 65535', 'error');
        return false;
    }

    const result = await window.electronAPI.validateTarget(data);
    if (!result.valid) {
        showStatus(result.errors.join('; '), 'error');
        return false;
    }

    window.electronAPI.sendAdd(data);
    window.close();
    return false;
});

testBtn.addEventListener('click', async () => {
    const data = getFormData();

    if (data.port && !validatePort(data.port)) {
        showStatus('Port must be a number between 1 and 65535', 'error');
        return;
    }

    if (!data.url) {
        showStatus('Target URL is required', 'error');
        return;
    }

    showStatus('Testing connection...', 'testing');
    testBtn.disabled = true;
    try {
        const result = await window.electronAPI.testConnection(data);
        if (result.success) {
            showStatus('Connection successful', 'success');
        } else {
            showStatus(result.error, 'error');
        }
    } catch (e) {
        showStatus(e.message, 'error');
    }
    testBtn.disabled = false;
});

// Initial fit on load
fitWindow();
