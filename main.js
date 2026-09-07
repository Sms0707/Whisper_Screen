const { app, BrowserWindow, desktopCapturer, session } = require('electron');

let whisperWindow;
let meetWasOpened = false;
let checkCounter = 0; // Gives you time to open Meet before auto-closing

app.whenReady().then(() => {
  whisperWindow = new BrowserWindow({
    width: 400,
    height: 750,
    alwaysOnTop: true,
    show: false, // Stays hidden until Google Meet is detected
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  whisperWindow.loadFile('index.html');

  // FIX 1: Properly handles screen sharing requests inside Electron
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      // Automatically selects the primary window/screen feed
      callback({ video: sources[0], audio: 'loopback' });
    } catch (error) {
      console.error("Screen capture error:", error);
    }
  });

  // Automatically approve media permissions
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
    } else {
      callback(false);
    }
  });

  // FIX 2: Background Gateway & Smart Auto-Close Loop
  setInterval(async () => {
    try {
      checkCounter++;
      const sources = await desktopCapturer.getSources({ types: ['window'] });
      const isMeetOpen = sources.some(source => source.name && source.name.includes('Google Meet'));

      if (isMeetOpen) {
        meetWasOpened = true; // Mark that Meet has successfully opened
        if (whisperWindow && !whisperWindow.isVisible()) {
          whisperWindow.show(); // Automatically pops up over Google Meet!
        }
      } else {
        // Only start checking for closure AFTER the first 5 checks (prevents instant shutdown)
        if (checkCounter > 5 && meetWasOpened) {
          console.log("Google Meet closed. Shutting down Whisper Screen.");
          app.quit(); // Automatically closes the app completely
        }
      }
    } catch (err) {
      // Ignore temporary scanning errors
    }
  }, 3000);
});
