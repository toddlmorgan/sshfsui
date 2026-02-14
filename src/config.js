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
const SSH_TIMEOUT = 15


class Target {
    constructor(name, url, mount, authType = 'key', port = '', identityFile = '', sshOptions = '', autoconnect = false) {
        this.name = name;
        this.url = url;
        this.mount = mount;
        this.authType = authType;
        this.port = port;
        this.identityFile = identityFile;
        this.sshOptions = sshOptions;
        this.autoconnect = autoconnect;
    }

    _sshOpts() {
        const sshFlags = [];
        const sshfsFlags = [];
        if (this.port) {
            sshFlags.push('-p', this.port);
            sshfsFlags.push('-p', this.port);
        }
        if (this.identityFile) {
            sshFlags.push('-i', this.identityFile);
            sshfsFlags.push('-o', `IdentityFile=${this.identityFile}`);
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
        const urlMatch = this.url + ' on';
        const foundURL = stdout.indexOf(urlMatch) !== -1;
        const foundMount = stdout.indexOf(this.mount) !== -1;
        return foundURL || foundMount;
    }

    async connect() {
        await this.testSSH();
        const { sshfsFlags } = this._sshOpts();
        try {
            if (this.authType === 'password') {
                const password = this._decryptPassword();
                const args = [String(SSH_TIMEOUT), 'sshfs', ...sshfsFlags, '-o', 'password_stdin', this.url, this.mount];
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
                await exec(`timeout ${SSH_TIMEOUT} sshfs ${flagStr}${this.url} ${this.mount}`);
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
        const credPath = configDir + '/' + this.name + '/credential';
        const encrypted = fs.readFileSync(credPath);
        return safeStorage.decryptString(encrypted);
    }

    async cleanupSSHFS() {
        const { stdout } = await exec(`ps aux | grep sshfs`)
        const lines = stdout.split('\n');
        const filteredGrep = lines.filter(l => !l.includes('grep '));
        const filteredURLs = filteredGrep.filter(l => l.includes(this.url));
        const absoluteMount = untildify(this.mount);
        const filteredMount = filteredURLs.filter(l => l.includes(absoluteMount));
        const line = filteredMount[0];
        const parts = line.split(' ');
        const pid = parts[1];
        kill(pid, 'SIGKILL');
    }

    async disconnect() {
        const mountPath = untildify(this.mount);
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


export function fetchOrCreateEmptyConfig() {
    try {
        return fetchConfig();
    } catch (error) {
        console.log(error);
        createEmptyConfig();
        return [];
    }
}

function fetchConfig() {
    const config = [];
    const targetNames = fs.readdirSync(configDir, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .filter(item => !item.name.startsWith('.'))
        .map(item => item.name);
    for (const name of targetNames) {
        const base = configDir + '/' + name + '/';
        const targetURL = fs.readFileSync(base + "target", { encoding: 'utf8' }).trim();
        const targetMount = fs.readFileSync(base + "mount", { encoding: 'utf8' }).trim();
        let authType = 'key';
        try {
            authType = fs.readFileSync(base + "auth", { encoding: 'utf8' }).trim();
        } catch {
            // Default to key-based auth for backward compatibility
        }
        let port = '';
        try {
            port = fs.readFileSync(base + "port", { encoding: 'utf8' }).trim();
        } catch {
            // Default to empty (use SSH default port 22)
        }
        let identityFile = '';
        try {
            identityFile = fs.readFileSync(base + "identity", { encoding: 'utf8' }).trim();
        } catch {
            // Default to empty (use SSH default key search)
        }
        let sshOptions = '';
        try {
            sshOptions = fs.readFileSync(base + "sshoptions", { encoding: 'utf8' }).trim();
        } catch {
            // Default to empty (no extra SSH options)
        }
        let autoconnect = false;
        try {
            autoconnect = fs.readFileSync(base + "autoconnect", { encoding: 'utf8' }).trim() === 'true';
        } catch {
            // Default to false (no auto-connect)
        }
        const t = new Target(name, targetURL, targetMount, authType, port, identityFile, sshOptions, autoconnect)
        config.push(t);
    }
    return config;
}

function createEmptyConfig() {
    fs.mkdirSync(configDir);
}


export function fetchDefaults() {
    const defaultsDir = configDir + '/.defaults';
    const defaults = { mountroot: '', identity: '', sshoptions: '', port: '' };
    for (const key of Object.keys(defaults)) {
        try {
            defaults[key] = fs.readFileSync(defaultsDir + '/' + key, { encoding: 'utf8' }).trim();
        } catch {
            // Missing file — keep empty default
        }
    }
    return defaults;
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
    const safeName = dirName.replace(/[\/\\:*?"<>|]/g, '_');
    return root + '/' + safeName;
}

export function addTarget(name, url, mount, authType = 'key', password = null, port = '', identityFile = '', sshOptions = '', autoconnect = false) {
    const targetBase = configDir + '/' + name;
    fs.mkdirSync(targetBase);
    fs.writeFileSync(targetBase + "/target", url, { encoding: 'utf8' });
    fs.writeFileSync(targetBase + "/mount", mount, { encoding: 'utf8' });
    fs.writeFileSync(targetBase + "/auth", authType, { encoding: 'utf8' });
    if (authType === 'password' && password) {
        const encrypted = safeStorage.encryptString(password);
        fs.writeFileSync(targetBase + "/credential", encrypted, { mode: 0o600 });
    }
    if (port) {
        fs.writeFileSync(targetBase + "/port", port, { encoding: 'utf8' });
    }
    if (identityFile) {
        fs.writeFileSync(targetBase + "/identity", identityFile, { encoding: 'utf8' });
    }
    if (sshOptions) {
        fs.writeFileSync(targetBase + "/sshoptions", sshOptions, { encoding: 'utf8' });
    }
    fs.writeFileSync(targetBase + "/autoconnect", autoconnect ? 'true' : 'false', { encoding: 'utf8' });

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
        sshFlags.push('-i', identityFile);
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
    const target = configDir + '/' + name;
    fs.rmSync(target, {recursive: true});
}
