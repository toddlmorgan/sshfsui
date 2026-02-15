function parseSSHString(input) {
    const trimmed = input.trim();
    const withoutSSH = trimmed.replace(/^(ssh|scp)\s+/, '');

    const result = { host: '', port: '', identityFile: '', options: [] };
    const tokens = withoutSSH.split(/\s+/);

    let i = 0;
    while (i < tokens.length) {
        if (tokens[i] === '-p' && tokens[i+1]) {
            result.port = tokens[++i];
        } else if (tokens[i] === '-i' && tokens[i+1]) {
            result.identityFile = tokens[++i];
        } else if (tokens[i] === '-o' && tokens[i+1]) {
            result.options.push('-o', tokens[++i]);
            i++;
            continue;
        } else if (tokens[i].includes('@') && !result.host) {
            result.host = tokens[i];
        }
        i++;
    }
    return result.host ? result : null;
}
