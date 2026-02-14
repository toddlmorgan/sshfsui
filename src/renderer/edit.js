const form = document.querySelector("#edit");
const authSelect = form.querySelector('select[name="authType"]');
const passwordRow = document.querySelector('#password-row');
const passwordInput = form.querySelector('input[name="password"]');

window.electronAPI.onLoad(setInitialData);

let initialName;

function setInitialData(event, data) {
    initialName = data.name;
    form.querySelector('input[name="name"]').value = data.name;
    form.querySelector('input[name="url"]').value = data.url;
    form.querySelector('input[name="mount"]').value = data.mount;
    form.querySelector('input[name="port"]').value = data.port || '';
    form.querySelector('input[name="identityFile"]').value = data.identityFile || '';
    if (data.authType) {
        authSelect.value = data.authType;
    }
    const isPassword = authSelect.value === 'password';
    passwordRow.style.display = isPassword ? '' : 'none';
    passwordInput.required = isPassword;
}

authSelect.addEventListener('change', () => {
    const isPassword = authSelect.value === 'password';
    passwordRow.style.display = isPassword ? '' : 'none';
    passwordInput.required = isPassword;
});

form.addEventListener('submit', sendEditDataAndCloseWindow);

function sendEditDataAndCloseWindow(event) {
    event.preventDefault();
    const data = {
        initialName,
        target: {
            name: form.querySelector('input[name="name"]').value,
            url: form.querySelector('input[name="url"]').value,
            mount: form.querySelector('input[name="mount"]').value,
            port: form.querySelector('input[name="port"]').value || '',
            identityFile: form.querySelector('input[name="identityFile"]').value || '',
            authType: authSelect.value,
            password: passwordInput.value || null,
        }
    };
    window.electronAPI.sendEdit(data);
    window.close();
    return false;
}
