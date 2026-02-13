const form = document.querySelector("#add");
const authSelect = form.querySelector('select[name="authType"]');
const passwordRow = document.querySelector('#password-row');
const passwordInput = form.querySelector('input[name="password"]');

authSelect.addEventListener('change', () => {
    const isPassword = authSelect.value === 'password';
    passwordRow.style.display = isPassword ? '' : 'none';
    passwordInput.required = isPassword;
});

form.addEventListener('submit', sendAddDataAndCloseWindow);

function sendAddDataAndCloseWindow(event) {
    event.preventDefault();
    const data = {
        name: form.querySelector('input[name="name"]').value,
        url: form.querySelector('input[name="url"]').value,
        mount: form.querySelector('input[name="mount"]').value,
        authType: authSelect.value,
        password: passwordInput.value || null,
    };
    window.electronAPI.sendAdd(data);
    window.close();
    return false;
}
