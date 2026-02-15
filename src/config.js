import os from "os";
import fs from "fs";
import util from "util";
import * as child_process from "child_process";
import path from "path";
import untildify from "untildify";
import * as sudo from "sudo-prompt";
import { kill } from "process";
import { safeStorage } from "electron";

const exec = util.promisify(child_process.exec)

const configDir = os.homedir() + '/.sshfsui'
const configPath = configDir + '/config.json'
const logPath = configDir + '/sshfsui.log'
const SSH_TIMEOUT = 15
const MOUNT_VERIFY_RETRIES = 6
const MOUNT_VERIFY_INTERVAL = 500

const DEFAULT_DEFAULTS = { mountroot: '', identity: '', sshoptions: '', port: '' };


// --- Logging ---

function log(level, message) {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} [${level}] ${message}\n`;
    try {
        ensureConfigDir();
        fs.appendFileSync(logPath, line, { encoding: 'utf8' });
    } catch {}
    if (level === 'ERROR') {
        console.error(line.trim());
    } else {
        console.log(line.trim());
    }
}

export function getLogPath() {
    return logPath;
}

export function readLogTail(lines = 100) {
    try {
        const content = fs.readFileSync(logPath, { encoding: 'utf8' });
        const allLines = content.split('\n');
        return allLines.slice(-lines).join('\n');
    } catch {
        return '(no log file found)';
    }
}


class Target {
    constructor(name, url, mount, authType = 'key', port = '', identityFile = '', sshOptions = '', autoconnect = false, credential = null) {
        this.name = name;
        this.url = url;
        this.mount = mount;
        this.authType = authType;
        this.port = port;
        this.identityFile = identityFile;
        this.sshOptions = sshOptions;
        this.autoconnect = autoconnect;
        this.credential = credential;
    }

    _sshfsUrl() {
        // sshfs requires at least user@host: — append : if missing
        if (this.url.indexOf(':') === -1) {
            return this.url + ':';
        }
        return this.url;
    }

    _absoluteMount() {
        return untildify(this.mount);
    }

    _sshOpts() {
        const sshFlags = [];
        const sshfsFlags = [];
        if (this.port) {
            sshFlags.push('-p', this.port);
            sshfsFlags.push('-p', this.port);
        }
        if (this.identityFile) {
            const resolved = untildify(this.identityFile);
            sshFlags.push('-i', resolved);
            sshfsFlags.push('-o', `IdentityFile=${resolved}`);
        }
        if (this.sshOptions) {
            const tokens = this.sshOptions.split(/\s+/).filter(Boolean);
            sshFlags.push(...tokens);
            sshfsFlags.push(...tokens);
        }
        return { sshFlags, sshfsFlags };
    }

    async status() {
        const { stdout } = await exec('mount');
        const absoluteMount = this._absoluteMount();
        // Check for the absolute mount path in mount output (most reliable)
        const foundMount = stdout.indexOf(absoluteMount) !== -1;
        // Also check URL variants
        const urlMatch = this.url + ' on';
        const sshfsUrlMatch = this._sshfsUrl() + ' on';
        const foundURL = stdout.indexOf(urlMatch) !== -1 || stdout.indexOf(sshfsUrlMatch) !== -1;

        if (!foundURL && !foundMount) return false;

        // Mount entry exists in table — probe it to check for stale FUSE mounts.
        // A dead sshfs daemon leaves a mount entry but any I/O returns EIO or ENOTCONN.
        try {
            fs.readdirSync(absoluteMount);
            return true;
        } catch (e) {
            // ENOTCONN (errno -107 Linux, code ENOTCONN) or EIO = stale FUSE mount
            if (e.code === 'ENOTCONN' || e.code === 'EIO') {
                log('WARN', `[${this.name}] Stale FUSE mount detected at ${absoluteMount} (${e.code}), cleaning up`);
                try { await this.forceCleanup(); } catch (cleanupErr) {
                    log('ERROR', `[${this.name}] Stale mount cleanup failed: ${cleanupErr.message}`);
                }
                return false;
            }
            // EACCES or other errors — mount may be alive but unreadable, treat as connected
            return true;
        }
    }

    async connect() {
        log('INFO', `[${this.name}] Starting connection to ${this.url}`);
        log('INFO', `[${this.name}] Auth type: ${this.authType}, mount: ${this.mount}`);

        await this.testSSH();
        log('INFO', `[${this.name}] SSH test passed`);

        const { sshfsFlags } = this._sshOpts();
        const sshfsUrl = this._sshfsUrl();
        const absoluteMount = this._absoluteMount();

        log('INFO', `[${this.name}] sshfs URL: ${sshfsUrl}, absolute mount: ${absoluteMount}`);
        if (sshfsFlags.length) {
            log('INFO', `[${this.name}] sshfs flags: ${sshfsFlags.join(' ')}`);
        }

        try {
            if (this.authType === 'password') {
                const password = this._decryptPassword();
                const args = [String(SSH_TIMEOUT), 'sshfs', ...sshfsFlags, '-o', 'password_stdin', sshfsUrl, absoluteMount];
                log('INFO', `[${this.name}] Running: timeout ${args.join(' ')} (password via stdin)`);
                await new Promise((resolve, reject) => {
                    const proc = child_process.spawn('timeout', args, {
                        stdio: ['pipe', 'pipe', 'pipe']
                    });
                    proc.stdin.write(password + '\n');
                    proc.stdin.end();
                    let stderr = '';
                    proc.stderr.on('data', (data) => { stderr += data; });
                    proc.on('close', (code) => {
                        if (code === 0) {
                            log('INFO', `[${this.name}] sshfs process exited with code 0`);
                            if (stderr.trim()) log('WARN', `[${this.name}] sshfs stderr: ${stderr.trim()}`);
                            resolve();
                        } else {
                            log('ERROR', `[${this.name}] sshfs exited with code ${code}: ${stderr}`);
                            reject(new Error(stderr || `sshfs exited with code ${code}`));
                        }
                    });
                });
            } else {
                const flagStr = sshfsFlags.length ? sshfsFlags.join(' ') + ' ' : '';
                const cmd = `timeout ${SSH_TIMEOUT} sshfs ${flagStr}${sshfsUrl} "${absoluteMount}"`;
                log('INFO', `[${this.name}] Running: ${cmd}`);
                const result = await exec(cmd);
                log('INFO', `[${this.name}] sshfs process completed`);
                if (result.stderr && result.stderr.trim()) {
                    log('WARN', `[${this.name}] sshfs stderr: ${result.stderr.trim()}`);
                }
            }
        } catch (e) {
            log('ERROR', `[${this.name}] sshfs command failed: ${e.message}`);
            try {
                await this.disconnect();
            } catch {
                // We can ignore any errors disconnecting since this only needs to be done on MacOS; Linux seems to
                // clean up after itself.
            }
            throw e;
        }

        // sshfs daemonizes by default — the parent exits 0 before the mount is ready.
        // We must wait for the mount to actually appear and verify it's real.
        await this.verifyMount();
    }

    async verifyMount() {
        const absoluteMount = this._absoluteMount();
        log('INFO', `[${this.name}] Verifying mount at ${absoluteMount}...`);

        // Step 1: Wait for mount to appear in mount table (sshfs daemonizes, may take a moment)
        let mountLine = null;
        for (let i = 0; i < MOUNT_VERIFY_RETRIES; i++) {
            const { stdout } = await exec('mount');
            const lines = stdout.split('\n');
            mountLine = lines.find(l => l.includes(absoluteMount));
            if (mountLine) break;
            log('INFO', `[${this.name}] Mount not in table yet, retrying (${i + 1}/${MOUNT_VERIFY_RETRIES})...`);
            await new Promise(r => setTimeout(r, MOUNT_VERIFY_INTERVAL));
        }

        if (!mountLine) {
            const msg = `Mount verification failed: ${absoluteMount} not found in mount table after ${MOUNT_VERIFY_RETRIES} attempts. sshfs may have daemonized but failed to mount.`;
            log('ERROR', `[${this.name}] ${msg}`);
            // Capture mount table and sshfs processes for diagnostics
            try {
                const { stdout: mountOut } = await exec('mount');
                log('ERROR', `[${this.name}] Full mount table:\n${mountOut}`);
            } catch {}
            try {
                const { stdout: psOut } = await exec('ps aux | grep sshfs');
                log('ERROR', `[${this.name}] sshfs processes:\n${psOut}`);
            } catch {}
            throw new Error(msg);
        }
        log('INFO', `[${this.name}] Mount found in table: ${mountLine.trim()}`);

        // Step 2: Compare disk size via df — if it matches the local disk, the mount is bogus
        try {
            const { stdout: dfMount } = await exec(`df -k "${absoluteMount}"`);
            const { stdout: dfLocal } = await exec(`df -k "${os.homedir()}"`);

            const mountDf = parseDfOutput(dfMount);
            const localDf = parseDfOutput(dfLocal);

            log('INFO', `[${this.name}] df mount: ${JSON.stringify(mountDf)}`);
            log('INFO', `[${this.name}] df local: ${JSON.stringify(localDf)}`);

            if (mountDf && localDf) {
                // If the filesystem device is the same, the remote mount didn't take effect
                if (mountDf.filesystem === localDf.filesystem) {
                    try { await this.forceCleanup(); } catch {}
                    const msg = `Mount verification failed: ${absoluteMount} is on the same filesystem as your local disk (${mountDf.filesystem}). The remote mount did not attach — check that macFUSE/FUSE-T is installed and working.`;
                    log('ERROR', `[${this.name}] ${msg}`);
                    throw new Error(msg);
                }

                // If total size is suspiciously close to local disk (within 1%), warn
                const sizeDiffRatio = Math.abs(mountDf.totalKB - localDf.totalKB) / localDf.totalKB;
                if (sizeDiffRatio < 0.01 && mountDf.totalKB > 0) {
                    try { await this.forceCleanup(); } catch {}
                    const localGB = (localDf.totalKB / 1048576).toFixed(1);
                    const mountGB = (mountDf.totalKB / 1048576).toFixed(1);
                    const msg = `Mount verification failed: ${absoluteMount} reports ${mountGB} GB total, same as local disk (${localGB} GB). The remote mount likely did not attach.`;
                    log('ERROR', `[${this.name}] ${msg}`);
                    throw new Error(msg);
                }

                const mountGB = (mountDf.totalKB / 1048576).toFixed(1);
                const availGB = (mountDf.availKB / 1048576).toFixed(1);
                log('INFO', `[${this.name}] Remote filesystem: ${mountGB} GB total, ${availGB} GB available`);
            }
        } catch (e) {
            if (e.message.startsWith('Mount verification failed')) throw e;
            log('WARN', `[${this.name}] df comparison failed (non-fatal): ${e.message}`);
        }

        // Step 3: Try to list directory contents
        try {
            const entries = fs.readdirSync(absoluteMount);
            log('INFO', `[${this.name}] Mount directory contains ${entries.length} items`);
            if (entries.length === 0) {
                log('WARN', `[${this.name}] Mount directory is empty — remote path may be empty or incorrect`);
            }
        } catch (e) {
            log('WARN', `[${this.name}] Could not read mount directory: ${e.message}`);
        }

        log('INFO', `[${this.name}] Mount verification passed`);
    }

    async testSSH() {
        const parts = this.url.split(':');
        const host = parts[0];
        const { sshFlags } = this._sshOpts();
        const flagStr = sshFlags.length ? sshFlags.join(' ') + ' ' : '';
        log('INFO', `[${this.name}] Testing SSH to ${host}...`);
        if (this.authType === 'password') {
            const password = this._decryptPassword();
            await exec(`sshpass -e timeout ${SSH_TIMEOUT} ssh ${flagStr}${host} echo ping`, {
                env: { ...process.env, SSHPASS: password }
            });
        } else {
            await exec(`timeout ${SSH_TIMEOUT} ssh ${flagStr}${host} echo ping`);
        }
    }

    _decryptPassword() {
        if (!this.credential) {
            throw new Error('No credential stored for ' + this.name);
        }
        const encrypted = Buffer.from(this.credential, 'base64');
        return safeStorage.decryptString(encrypted);
    }

    async killSSHFSProcess() {
        try {
            const { stdout } = await exec(`ps aux | grep sshfs`);
            const lines = stdout.split('\n');
            const absoluteMount = this._absoluteMount();
            const candidates = lines
                .filter(l => !l.includes('grep '))
                .filter(l => l.includes(this.url) || l.includes(absoluteMount));
            for (const line of candidates) {
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[1], 10);
                if (pid > 0) {
                    log('INFO', `[${this.name}] Killing sshfs process ${pid}`);
                    try { kill(pid, 'SIGKILL'); } catch {}
                }
            }
        } catch {
            // No matching processes — that's fine
        }
    }

    async forceCleanup() {
        const mountPath = this._absoluteMount();
        log('INFO', `[${this.name}] Force cleanup of ${mountPath}`);

        // Kill sshfs process first so umount can succeed
        await this.killSSHFSProcess();

        // Wait briefly for process to die
        await new Promise(r => setTimeout(r, 300));

        // Try each unmount method in order
        const methods = [
            `umount -f "${mountPath}"`,
            `umount "${mountPath}"`,
            ...(process.platform === 'darwin' ? [
                `diskutil unmount force "${mountPath}"`,
                `diskutil unmount "${mountPath}"`,
            ] : []),
        ];

        let lastErr = null;
        for (const cmd of methods) {
            try {
                await exec(cmd);
                log('INFO', `[${this.name}] Cleanup succeeded with: ${cmd}`);
                return;
            } catch (e) {
                lastErr = e;
            }
        }

        // If mount is no longer in mount table, cleanup is effectively done
        try {
            const { stdout } = await exec('mount');
            if (stdout.indexOf(mountPath) === -1) {
                log('INFO', `[${this.name}] Mount entry already gone from mount table`);
                return;
            }
        } catch {}

        log('WARN', `[${this.name}] All cleanup methods failed: ${lastErr?.message}`);
        throw new Error(`Could not clean up stale mount at ${mountPath}: ${lastErr?.message}`);
    }

    async disconnect() {
        const mountPath = this._absoluteMount();
        log('INFO', `[${this.name}] Disconnecting ${mountPath}`);
        try {
            await exec(`umount "${mountPath}"`);
            log('INFO', `[${this.name}] Disconnected via umount`);
            return;
        } catch {}

        if (process.platform === 'darwin') {
            try {
                await exec(`diskutil unmount "${mountPath}"`);
                log('INFO', `[${this.name}] Disconnected via diskutil unmount`);
                return;
            } catch {}
            try {
                await exec(`diskutil unmount force "${mountPath}"`);
                log('INFO', `[${this.name}] Disconnected via diskutil unmount force`);
                return;
            } catch {}
        }

        // All standard methods failed — try full force cleanup (kill process + umount -f)
        log('WARN', `[${this.name}] Standard unmount failed, attempting force cleanup`);
        await this.forceCleanup();
    }
}


// Parse df -k output into { filesystem, totalKB, usedKB, availKB }
function parseDfOutput(dfOutput) {
    const lines = dfOutput.trim().split('\n');
    if (lines.length < 2) return null;
    // df -k output: Filesystem 1024-blocks Used Available Capacity ...
    const parts = lines[1].split(/\s+/);
    if (parts.length < 4) return null;
    return {
        filesystem: parts[0],
        totalKB: parseInt(parts[1], 10),
        usedKB: parseInt(parts[2], 10),
        availKB: parseInt(parts[3], 10),
    };
}


// --- JSON config read/write helpers ---

function readConfig() {
    const raw = fs.readFileSync(configPath, { encoding: 'utf8' });
    return JSON.parse(raw);
}

function writeConfig(data) {
    const json = JSON.stringify(data, null, 2) + '\n';
    fs.writeFileSync(configPath, json, { encoding: 'utf8', mode: 0o600 });
}

function ensureConfigDir() {
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir);
    }
}


// --- Migration from flat files to JSON ---

function migrateFromFlatFiles() {
    const targets = [];
    const defaults = { ...DEFAULT_DEFAULTS };

    // Migrate defaults from .defaults/ directory
    const defaultsDir = configDir + '/.defaults';
    for (const key of Object.keys(defaults)) {
        try {
            defaults[key] = fs.readFileSync(defaultsDir + '/' + key, { encoding: 'utf8' }).trim();
        } catch {
            // Missing file — keep empty default
        }
    }

    // Migrate targets from subdirectories
    let entries;
    try {
        entries = fs.readdirSync(configDir, { withFileTypes: true });
    } catch {
        return null;
    }

    const targetDirs = entries
        .filter(item => item.isDirectory())
        .filter(item => !item.name.startsWith('.'));

    if (targetDirs.length === 0 && !fs.existsSync(defaultsDir)) {
        return null; // Nothing to migrate
    }

    for (const dir of targetDirs) {
        const name = dir.name;
        const base = configDir + '/' + name + '/';
        try {
            const url = fs.readFileSync(base + 'target', { encoding: 'utf8' }).trim();
            const mount = fs.readFileSync(base + 'mount', { encoding: 'utf8' }).trim();

            let authType = 'key';
            try { authType = fs.readFileSync(base + 'auth', { encoding: 'utf8' }).trim(); } catch {}

            let port = '';
            try { port = fs.readFileSync(base + 'port', { encoding: 'utf8' }).trim(); } catch {}

            let identityFile = '';
            try { identityFile = fs.readFileSync(base + 'identity', { encoding: 'utf8' }).trim(); } catch {}

            let sshOptions = '';
            try { sshOptions = fs.readFileSync(base + 'sshoptions', { encoding: 'utf8' }).trim(); } catch {}

            let autoconnect = false;
            try { autoconnect = fs.readFileSync(base + 'autoconnect', { encoding: 'utf8' }).trim() === 'true'; } catch {}

            let credential = null;
            if (authType === 'password') {
                try {
                    const encrypted = fs.readFileSync(base + 'credential');
                    credential = encrypted.toString('base64');
                } catch {}
            }

            targets.push({ name, url, mount, authType, port, identityFile, sshOptions, autoconnect, credential });
        } catch {
            // Skip directories that don't have required files
        }
    }

    return { defaults, targets };
}


// --- Public API ---

export function fetchOrCreateEmptyConfig() {
    try {
        ensureConfigDir();

        if (fs.existsSync(configPath)) {
            const data = readConfig();
            return (data.targets || []).map(t =>
                new Target(t.name, t.url, t.mount, t.authType, t.port, t.identityFile, t.sshOptions, t.autoconnect, t.credential)
            );
        }

        // Try migration from flat files
        const migrated = migrateFromFlatFiles();
        if (migrated) {
            writeConfig(migrated);
            log('INFO', `Migrated ${migrated.targets.length} targets from flat files to config.json`);
            return migrated.targets.map(t =>
                new Target(t.name, t.url, t.mount, t.authType, t.port, t.identityFile, t.sshOptions, t.autoconnect, t.credential)
            );
        }

        // Fresh install — create empty config
        writeConfig({ defaults: { ...DEFAULT_DEFAULTS }, targets: [] });
        return [];
    } catch (error) {
        log('ERROR', `fetchOrCreateEmptyConfig failed: ${error.message}`);
        ensureConfigDir();
        writeConfig({ defaults: { ...DEFAULT_DEFAULTS }, targets: [] });
        return [];
    }
}


export function fetchDefaults() {
    try {
        ensureConfigDir();
        if (fs.existsSync(configPath)) {
            const data = readConfig();
            return { ...DEFAULT_DEFAULTS, ...(data.defaults || {}) };
        }
    } catch {}
    return { ...DEFAULT_DEFAULTS };
}


export function saveDefaults(defaults) {
    ensureConfigDir();
    let data;
    try {
        data = readConfig();
    } catch {
        data = { defaults: { ...DEFAULT_DEFAULTS }, targets: [] };
    }
    data.defaults = { ...DEFAULT_DEFAULTS, ...defaults };
    writeConfig(data);
    log('INFO', `Defaults saved: ${JSON.stringify(data.defaults)}`);
}


export function generateMountPath(url, mountRoot) {
    const root = mountRoot || '~/sshfs_mounts';
    // Parse user@host:/remote/path
    const colonIdx = url.indexOf(':');
    const userHost = colonIdx !== -1 ? url.substring(0, colonIdx) : url;
    const remotePath = colonIdx !== -1 ? url.substring(colonIdx + 1) : '';

    // Extract last meaningful path component
    const pathParts = remotePath.split('/').filter(Boolean);
    const lastPart = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '';

    // Build: mountroot/user@host_lastpart (or just user@host if no path)
    const dirName = lastPart ? `${userHost}_${lastPart}` : userHost;
    // Sanitize: replace characters that are problematic in directory names
    const safeName = dirName.replace(/@/g, '_at_').replace(/[\/\\:*?"<>|]/g, '_');
    return root + '/' + safeName;
}

export function addTarget(name, url, mount, authType = 'key', password = null, port = '', identityFile = '', sshOptions = '', autoconnect = false) {
    ensureConfigDir();
    let data;
    try {
        data = readConfig();
    } catch {
        data = { defaults: { ...DEFAULT_DEFAULTS }, targets: [] };
    }

    let credential = null;
    if (authType === 'password' && password) {
        const encrypted = safeStorage.encryptString(password);
        credential = encrypted.toString('base64');
    }

    data.targets.push({ name, url, mount, authType, port, identityFile, sshOptions, autoconnect, credential });
    writeConfig(data);
    log('INFO', `Target added: ${name} → ${url} at ${mount}`);

    const absolutePath = untildify(mount);
    if (!fs.existsSync(absolutePath)) {
        try {
            fs.mkdirSync(absolutePath);
        } catch (error) {
            // This is the error code for permissions error.
            if (error.errno === -13) {
                sudo.exec('mkdir ' + absolutePath, { name: 'sshfs' }, (e, stdout, stderr) => {
                    if (!e) {
                        const username = os.userInfo().username
                        sudo.exec(`chown ${username}:${username} ${absolutePath}`, { name: 'sshfs' }, (e, stdout, stderr) => {});
                    }
                });
            }
        }
    }
}


export async function testSSHConnection(url, port, identityFile, authType, password, sshOptions = '') {
    const parts = url.split(':');
    const host = parts[0];
    const sshFlags = [];
    if (port) {
        sshFlags.push('-p', port);
    }
    if (identityFile) {
        const resolved = untildify(identityFile);
        sshFlags.push('-i', resolved);
    }
    if (sshOptions) {
        const tokens = sshOptions.split(/\s+/).filter(Boolean);
        sshFlags.push(...tokens);
    }
    const flagStr = sshFlags.length ? sshFlags.join(' ') + ' ' : '';
    if (authType === 'password' && password) {
        await exec(`sshpass -e timeout ${SSH_TIMEOUT} ssh ${flagStr}${host} echo ping`, {
            env: { ...process.env, SSHPASS: password }
        });
    } else {
        await exec(`timeout ${SSH_TIMEOUT} ssh ${flagStr}${host} echo ping`);
    }
}


export function deleteTarget(name) {
    let data;
    try {
        data = readConfig();
    } catch {
        return;
    }
    data.targets = data.targets.filter(t => t.name !== name);
    writeConfig(data);
    log('INFO', `Target deleted: ${name}`);
}
