// Capture updated screenshots of the sshfsui Electron windows using Playwright.
// Usage: node scripts/capture-screenshots.mjs
//
// Produces:
//   docs/screenshot-add.png   — Add target form with sample data
//
// Note: The tray menu screenshot (docs/screenshot.png) must be captured
// manually since it is a native macOS menu that Playwright cannot interact with.

import { _electron } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.join(__dirname, '..');

async function main() {
    console.log('Launching Electron app for screenshot capture...');

    const electronApp = await _electron.launch({
        args: [path.join(projectDir, 'scripts', 'screenshot-main.cjs')],
        cwd: projectDir,
    });

    // Wait for the Add form window
    console.log('Capturing Add form...');
    const addPage = await electronApp.firstWindow();
    await addPage.waitForLoadState('domcontentloaded');

    // Wait for resize-to-content to settle
    await addPage.waitForTimeout(800);

    // Fill with generic sample data (no sensitive/environment-specific content)
    await addPage.fill('input[name="name"]', 'myserver');
    await addPage.fill('input[name="url"]', 'user@example.com:/home/user/documents');
    await addPage.fill('input[name="mount"]', '~/mnt/myserver');

    // Ensure password row is hidden (auth type defaults to SSH Key)
    await addPage.evaluate(() => {
        document.querySelector('#password-row').style.display = 'none';
    });

    // Blur all focused elements to remove focus outlines
    await addPage.evaluate(() => {
        document.activeElement?.blur();
    });

    // Wait for any layout/resize to settle
    await addPage.waitForTimeout(500);

    const screenshotPath = path.join(projectDir, 'docs', 'screenshot-add.png');
    await addPage.screenshot({
        path: screenshotPath,
    });
    console.log('  Saved docs/screenshot-add.png');

    await electronApp.close();
    console.log('Done.');
}

main().catch(err => {
    console.error('Screenshot capture failed:', err);
    process.exit(1);
});
