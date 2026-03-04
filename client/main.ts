// Import local classes
import { Data } from './data';
import { UI } from './ui';
import { Authenticator } from './auth';
import { Idler } from './idler';

declare global {
	interface Window {
		data: Data;
		auth: Authenticator;
		ui: UI;
		idler: Idler;

		sleep(ms: number): Promise<void>;
		restartComputer(): boolean;
		brightness: {
			decrease: () => void;
			increase: () => void;
		};
	}
}

// use with await window.sleep(1000); to sleep for 1 second
async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
window.sleep = sleep;

let debugLog: (message: string) => void = (message: string) => {
	console.debug(message);
};

// use with window.restartComputer(); to restart the computer
window.restartComputer = () => {
	try {
		if (!window.lightdm?.can_restart) {
			debugLog("Rebooting failed: lightdm.can_restart is false");
			return false;
		}

		window.lightdm?.restart();
		return true;
	}
	catch (err) {
		debugLog(`Rebooting failed: ${err}`);
		return false;
	}
};

window.brightness = {
	decrease: () => {
		if (!window.lightdm?.can_access_brightness) {
			debugLog('Brightness control failed: lightdm.can_access_brightness is false');
			return;
		}
		window.lightdm?.brightness_decrease(10);
	},
	increase: () => {
		if (!window.lightdm?.can_access_brightness) {
			debugLog('Brightness control failed: lightdm.can_access_brightness is false');
			return;
		}
		window.lightdm?.brightness_increase(10);
	}
};

async function initGreeter(): Promise<void> {
	// Initialize local classes
	const data = new Data();
	const auth = new Authenticator();
	const ui = new UI(data, auth);
	const idler = new Idler(ui.isLockScreen);
	let debugKeys = false;

	// Keep global references for legacy modules that still read from window.
	window.data = data;
	window.auth = auth;
	window.ui = ui;
	window.idler = idler;
	debugLog = (message: string) => ui.setDebugInfo(message);

	// Prefer explicit handler injection instead of reading window.ui from inside these classes.
	data.setDebugHandler((message: string) => ui.setDebugInfo(message));
	auth.setDebugHandler((message: string) => ui.setDebugInfo(message));

	// Add reboot keybind to reboot on ctrl+alt+del
	// only when the lock screen is not shown
	document.addEventListener('keydown', (e) => {
		const isPasswordInput = (document.activeElement?.tagName === 'INPUT' && document.activeElement?.getAttribute('type') === 'password');
		if (debugKeys && !isPasswordInput) {
			ui.setDebugInfo(`Key pressed: ${e.code} (${e.key})${e.ctrlKey ? ' + Ctrl' : ''}${e.altKey ? ' + Alt' : ''}${e.shiftKey ? ' + Shift' : ''}${e.metaKey ? ' + Meta' : ''}`);
		}
		if (e.ctrlKey && e.altKey) { // Special keybinds
			switch (e.key) {
				case 'Delete': // Ctrl + Alt + Delete = reboot computer
					if (debugKeys) {
						ui.setDebugInfo('Reboot requested through LightDM');
						window.restartComputer();
					}
					break;
				case 'e': // Ctrl + Alt + E = override exam mode
					if (debugKeys) {
						ui.setDebugInfo('Exam mode override enabled');
						ui.overrideExamMode();
					}
					break;
				case 'd': // Ctrl + Alt + D = debug keys: show pressed key in debug info
					debugKeys = !debugKeys;
					ui.setDebugInfo(`Debug keys: ${(debugKeys ? 'enabled' : 'disabled')}`);
					break;
				case 'l':
					if (debugKeys) {
						// Todo add a force logout 
					}
					return;
			}
		}
		else { // Regular keybinds
			switch (e.key) {
				case 'BrightnessDown': // Brightness down key
				case 'F1': // F1 = Decrease brightness (F1 and F14 are often the same key)
				case 'F14': // F14 = Decrease brightness (on some keyboards, e.g. Cherry)
					window.brightness.decrease();
					break;
				case 'BrightnessUp': // Brightness up key
				case 'F2': // F2 = Increase brightness (F2 and F15 are often the same key)
				case 'F15': // F15 = Increase brightness (on some keyboards, e.g. Cherry)
					window.brightness.increase();
					break;
			}
		}
	});
}

window.addEventListener("GreeterReady", () => {
	initGreeter();
});
