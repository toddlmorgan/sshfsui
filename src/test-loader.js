// Custom ESM loader to mock 'electron' during tests

export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') {
        return {
            shortCircuit: true,
            url: 'electron:mock',
        };
    }
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    if (url === 'electron:mock') {
        return {
            shortCircuit: true,
            format: 'module',
            source: `
                export const safeStorage = {
                    encryptString(s) { return Buffer.from(s); },
                    decryptString(b) { return b.toString(); },
                };
            `,
        };
    }
    return nextLoad(url, context);
}
