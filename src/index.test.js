import test from 'node:test';
import assert from 'assert';
import { findMountLine, parseDfOutput, generateMountPath, Target, validateTargetName } from './config.js';

// --- findMountLine ---

test('findMountLine: matches exact mount point', () => {
    const output = 'sshfs#user@host:/remote on /mnt/myhost (osxfuse, nodev, nosuid)\n';
    assert.ok(findMountLine(output, '/mnt/myhost'));
});

test('findMountLine: returns null when no match', () => {
    const output = 'sshfs#user@host:/remote on /mnt/other (osxfuse)\n';
    assert.strictEqual(findMountLine(output, '/mnt/myhost'), null);
});

test('findMountLine: does not match partial mount point', () => {
    const output = 'sshfs#user@host:/remote on /mnt/myhost_extra (osxfuse)\n';
    assert.strictEqual(findMountLine(output, '/mnt/myhost'), null);
});

test('findMountLine: handles multiple lines', () => {
    const output = [
        '/dev/disk1 on / (hfs, local)',
        'sshfs#user@a:/path on /mnt/a (osxfuse)',
        'sshfs#user@b:/path on /mnt/b (osxfuse)',
    ].join('\n');
    const match = findMountLine(output, '/mnt/b');
    assert.ok(match);
    assert.ok(match.includes('/mnt/b'));
});

test('findMountLine: handles empty output', () => {
    assert.strictEqual(findMountLine('', '/mnt/test'), null);
});

test('findMountLine: handles mount point with spaces', () => {
    const output = 'sshfs#user@host:/ on /mnt/my host (osxfuse)\n';
    assert.ok(findMountLine(output, '/mnt/my host'));
});


// --- parseDfOutput ---

test('parseDfOutput: parses normal df output', () => {
    const output = [
        'Filesystem   1024-blocks      Used Available Capacity  Mounted on',
        '/dev/disk1    488245288 234567890 253677398    49%    /',
    ].join('\n');
    const result = parseDfOutput(output);
    assert.deepStrictEqual(result, {
        filesystem: '/dev/disk1',
        totalKB: 488245288,
        usedKB: 234567890,
        availKB: 253677398,
    });
});

test('parseDfOutput: returns null for single-line output', () => {
    assert.strictEqual(parseDfOutput('Filesystem   1024-blocks\n'), null);
});

test('parseDfOutput: returns null for empty output', () => {
    assert.strictEqual(parseDfOutput(''), null);
});

test('parseDfOutput: returns null for malformed data line', () => {
    const output = 'Filesystem   1024-blocks\nfoo bar\n';
    assert.strictEqual(parseDfOutput(output), null);
});

test('parseDfOutput: parses sshfs remote filesystem', () => {
    const output = [
        'Filesystem       1024-blocks    Used   Available Capacity  Mounted on',
        'user@host:/path   102400000  51200000  51200000    50%    /mnt/remote',
    ].join('\n');
    const result = parseDfOutput(output);
    assert.strictEqual(result.filesystem, 'user@host:/path');
    assert.strictEqual(result.totalKB, 102400000);
});


// --- generateMountPath ---

test('generateMountPath: basic user@host:/path', () => {
    const result = generateMountPath('user@host:/remote/data', '~/mounts');
    assert.strictEqual(result, '~/mounts/user_at_host_data');
});

test('generateMountPath: user@host without remote path', () => {
    const result = generateMountPath('user@host', '~/mounts');
    assert.strictEqual(result, '~/mounts/user_at_host');
});

test('generateMountPath: user@host: with trailing colon only', () => {
    const result = generateMountPath('user@host:', '~/mounts');
    assert.strictEqual(result, '~/mounts/user_at_host');
});

test('generateMountPath: uses default mount root when empty', () => {
    const result = generateMountPath('user@host:/path', '');
    assert.strictEqual(result, '~/sshfs_mounts/user_at_host_path');
});

test('generateMountPath: deep remote path uses last component', () => {
    const result = generateMountPath('user@host:/a/b/c/deep', '~/m');
    assert.strictEqual(result, '~/m/user_at_host_deep');
});


// --- Target._sshfsUrl ---

test('Target._sshfsUrl: appends colon if missing', () => {
    const t = new Target('test', 'user@host', '/mnt/test');
    assert.strictEqual(t._sshfsUrl(), 'user@host:');
});

test('Target._sshfsUrl: preserves existing colon', () => {
    const t = new Target('test', 'user@host:/path', '/mnt/test');
    assert.strictEqual(t._sshfsUrl(), 'user@host:/path');
});

test('Target._sshfsUrl: preserves colon with empty path', () => {
    const t = new Target('test', 'user@host:', '/mnt/test');
    assert.strictEqual(t._sshfsUrl(), 'user@host:');
});


// --- Target._sshOpts ---

test('Target._sshOpts: empty options produce empty arrays (except volname on darwin)', () => {
    const t = new Target('test', 'user@host', '/mnt/test');
    const { sshFlags, sshfsFlags } = t._sshOpts();
    assert.deepStrictEqual(sshFlags, []);
    if (process.platform === 'darwin') {
        assert.deepStrictEqual(sshfsFlags, ['-o', 'volname=test']);
    } else {
        assert.deepStrictEqual(sshfsFlags, []);
    }
});

test('Target._sshOpts: port adds -p flag', () => {
    const t = new Target('test', 'user@host', '/mnt/test', 'key', '2222');
    const { sshFlags, sshfsFlags } = t._sshOpts();
    assert.ok(sshFlags.includes('-p'));
    assert.ok(sshFlags.includes('2222'));
    assert.ok(sshfsFlags.includes('-p'));
    assert.ok(sshfsFlags.includes('2222'));
});

test('Target._sshOpts: identity file adds -i for ssh, -o IdentityFile for sshfs', () => {
    const t = new Target('test', 'user@host', '/mnt/test', 'key', '', '/home/user/.ssh/id_rsa');
    const { sshFlags, sshfsFlags } = t._sshOpts();
    assert.ok(sshFlags.includes('-i'));
    assert.ok(sshFlags.includes('/home/user/.ssh/id_rsa'));
    assert.ok(sshfsFlags.includes('-o'));
    assert.ok(sshfsFlags.includes('IdentityFile=/home/user/.ssh/id_rsa'));
});

test('Target._sshOpts: sshOptions are tokenized and added', () => {
    const t = new Target('test', 'user@host', '/mnt/test', 'key', '', '', '-o StrictHostKeyChecking=no');
    const { sshFlags, sshfsFlags } = t._sshOpts();
    assert.ok(sshFlags.includes('-o'));
    assert.ok(sshFlags.includes('StrictHostKeyChecking=no'));
    assert.ok(sshfsFlags.includes('-o'));
    assert.ok(sshfsFlags.includes('StrictHostKeyChecking=no'));
});


// --- Target._absoluteMount ---

test('Target._absoluteMount: expands tilde', () => {
    const t = new Target('test', 'user@host', '~/mnt/test');
    const result = t._absoluteMount();
    assert.ok(!result.includes('~'));
    assert.ok(result.endsWith('/mnt/test'));
});

test('Target._absoluteMount: absolute path unchanged', () => {
    const t = new Target('test', 'user@host', '/mnt/test');
    assert.strictEqual(t._absoluteMount(), '/mnt/test');
});


// --- parseSSHString (from renderer/utils.js — tested inline since it's not an ES module) ---

// Re-implement for testing since utils.js is a plain browser script
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

test('parseSSHString: simple ssh command', () => {
    const result = parseSSHString('ssh user@host');
    assert.strictEqual(result.host, 'user@host');
    assert.strictEqual(result.port, '');
    assert.strictEqual(result.identityFile, '');
});

test('parseSSHString: ssh with port', () => {
    const result = parseSSHString('ssh user@host -p 3333');
    assert.strictEqual(result.host, 'user@host');
    assert.strictEqual(result.port, '3333');
});

test('parseSSHString: ssh with identity file', () => {
    const result = parseSSHString('ssh -i ~/.ssh/mykey user@host');
    assert.strictEqual(result.host, 'user@host');
    assert.strictEqual(result.identityFile, '~/.ssh/mykey');
});

test('parseSSHString: ssh with port and identity and options', () => {
    const result = parseSSHString('ssh -p 2222 -i ~/.ssh/id -o StrictHostKeyChecking=no user@host');
    assert.strictEqual(result.host, 'user@host');
    assert.strictEqual(result.port, '2222');
    assert.strictEqual(result.identityFile, '~/.ssh/id');
    assert.deepStrictEqual(result.options, ['-o', 'StrictHostKeyChecking=no']);
});

test('parseSSHString: scp command', () => {
    const result = parseSSHString('scp user@host:/path/file .');
    assert.strictEqual(result.host, 'user@host:/path/file');
});

test('parseSSHString: returns null for no host', () => {
    assert.strictEqual(parseSSHString('ssh -p 22'), null);
});

test('parseSSHString: bare user@host (no ssh prefix)', () => {
    const result = parseSSHString('user@host -p 2222');
    assert.strictEqual(result.host, 'user@host');
    assert.strictEqual(result.port, '2222');
});


// --- validateTargetName ---

test('validateTargetName: valid simple name', () => {
    assert.strictEqual(validateTargetName('my-server'), null);
});

test('validateTargetName: valid name with underscores and numbers', () => {
    assert.strictEqual(validateTargetName('server_2'), null);
});

test('validateTargetName: valid name with spaces', () => {
    assert.strictEqual(validateTargetName('my server'), null);
});

test('validateTargetName: rejects empty name', () => {
    assert.ok(validateTargetName('') !== null);
});

test('validateTargetName: rejects name over 64 characters', () => {
    assert.ok(validateTargetName('a'.repeat(65)) !== null);
});

test('validateTargetName: rejects name with slashes', () => {
    assert.ok(validateTargetName('bad/name') !== null);
});

test('validateTargetName: rejects name with special characters', () => {
    assert.ok(validateTargetName('bad<name>') !== null);
});

test('validateTargetName: rejects name that is only dots', () => {
    assert.ok(validateTargetName('..') !== null);
});

test('validateTargetName: rejects name with commas (FUSE option separator)', () => {
    assert.ok(validateTargetName('name,with,commas') !== null);
});
