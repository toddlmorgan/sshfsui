const form = document.querySelector("#add");
const authSelect = form.querySelector('select[name="authType"]');
const passwordRow = document.querySelector('#password-row');
const passwordInput = form.querySelector('input[name="password"]');
const statusMessage = document.querySelector('#status-message');
const testBtn = document.querySelector('#test-btn');

authSelect.addEventListener('change', () => {
    const isPassword = authSelect.value === 'password';
    passwordRow.style.display = isPassword ? '' : 'none';
    passwordInput.required = isPassword;
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
    };
}

function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = type;
}

function clearStatus() {
    statusMessage.textContent = '';
    statusMessage.className = '';
}

function validatePort(port) {
    if (!port) return true;
    const p = parseInt(port, 10);
    return !isNaN(p) && p >= 1 && p <= 65535 && String(p) === port;
}

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
