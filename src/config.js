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
const SSH_TIMEOUT = 15

const DEFAULT_DEFAULTS = { mountroot: '', identity: '', sshoptions: '', port: '' };


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
        return foundURL || foundMount;
    }

    async connect() {
        await this.testSSH();
        const { sshfsFlags } = this._sshOpts();
        const sshfsUrl = this._sshfsUrl();
        const absoluteMount = this._absoluteMount();
        try {
            if (this.authType === 'password') {
                const password = this._decryptPassword();
                const args = [String(SSH_TIMEOUT), 'sshfs', ...sshfsFlags, '-o', 'password_stdin', sshfsUrl, absoluteMount];
                await new Promise((resolve, reject) => {
                    const proc = child_process.spawn('timeout', args, {
                        stdio: ['pipe', 'pipe', 'pipe']
                    });
                    proc.stdin.write(password + '\n');
                    proc.stdin.end();
                    let stderr = '';
                    proc.stderr.on('data', (data) => { stderr += data; });
                    proc.on('close', (code) => {
                        if (code === 0) resolve();
                        else reject(new Error(stderr || `sshfs exited with code ${code}`));
                    });
                });
            } else {
                const flagStr = sshfsFlags.length ? sshfsFlags.join(' ') + ' ' : '';
                await exec(`timeout ${SSH_TIMEOUT} sshfs ${flagStr}${sshfsUrl} ${absoluteMount}`);
            }
        } catch (e) {
            try {
                await this.disconnect();
            } catch {
                // We can ignore any errors disconnecting since this only needs to be done on MacOS; Linux seems to
                // clean up after itself.
            }
            throw e;
        }

        // Verify the mount actually took effect
        await this.verifyMount();
    }

    async verifyMount() {
        const absoluteMount = this._absoluteMount();

        // Check 1: mount point should appear in mount output
        const { stdout } = await exec('mount');
        if (stdout.indexOf(absoluteMount) === -1) {
            throw new Error(`Mount verification failed: ${absoluteMount} not found in mount table. sshfs may have exited without mounting.`);
        }

        // Check 2: filesystem stats should indicate a remote mount (different device)
        try {
            const mountStat = fs.statfsSync(absoluteMount);
            const localStat = fs.statfsSync(os.homedir());
            // If the filesystem type or total block count is identical to the local drive,
            // and the mount's total size matches the local drive, it's likely not mounted
            if (mountStat.type === localStat.type &&
                mountStat.blocks === localStat.blocks &&
                mountStat.bsize === localStat.bsize) {
                // Clean up the failed mount
                try { await this.disconnect(); } catch {}
                throw new Error(
                    `Mount verification failed: ${absoluteMount} appears to show the local filesystem ` +
                    `(same device stats as /). The remote mount may not have attached correctly.`
                );
            }
        } catch (e) {
            // If it's our own verification error, re-throw it
            if (e.message.startsWith('Mount verification failed')) throw e;
            // statfsSync not available or errored — skip this check
        }
    }

    async testSSH() {
        const parts = this.url.split(':');
        const host = parts[0];
        const { sshFlags } = this._sshOpts();
        const flagStr = sshFlags.length ? sshFlags.join(' ') + ' ' : '';
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

    async cleanupSSHFS() {
        const { stdout } = await exec(`ps aux | grep sshfs`)
        const lines = stdout.split('\n');
        const filteredGrep = lines.filter(l => !l.includes('grep '));
        const filteredURLs = filteredGrep.filter(l => l.includes(this.url));
        const absoluteMount = this._absoluteMount();
        const filteredMount = filteredURLs.filter(l => l.includes(absoluteMount));
        const line = filteredMount[0];
        const parts = line.split(' ');
        const pid = parts[1];
        kill(pid, 'SIGKILL');
    }

    async disconnect() {
        const mountPath = this._absoluteMount();
        try {
            await exec(`umount ${mountPath}`);
        } catch (e) {
            // On macOS, umount often fails with "Resource busy" for FUSE mounts
            if (process.platform === 'darwin') {
                try {
                    await exec(`diskutil unmount ${mountPath}`);
                } catch {
                    // Force unmount as last resort
                    await exec(`diskutil unmount force ${mountPath}`);
                }
            } else {
                throw e;
            }
        }
    }
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
            return migrated.targets.map(t =>
                new Target(t.name, t.url, t.mount, t.authType, t.port, t.identityFile, t.sshOptions, t.autoconnect, t.credential)
            );
        }

        // Fresh install — create empty config
        writeConfig({ defaults: { ...DEFAULT_DEFAULTS }, targets: [] });
        return [];
    } catch (error) {
        console.log(error);
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
}
