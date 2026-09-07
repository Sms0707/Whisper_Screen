const { app, BrowserWindow, session } = require('electron');
const activeWin = require('active-win');

let whisperWindow;
let meetWasOpened = false;

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

  // Enable the native browser/system picker so you can choose what to share
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // Left empty because useSystemPicker handles the interactive dialog box
  }, { useSystemPicker: true });

  // Background Gateway & Auto-Close Loop
  setInterval(async () => {
    try {
      const currentWindow = await activeWin();
      if (currentWindow && currentWindow.title && currentWindow.title.includes('Google Meet')) {
        meetWasOpened = true;
        if (whisperWindow && !whisperWindow.isVisible()) {
          whisperWindow.show(); // Automatically pops up when Meet opens
        }
      } else {
        // If Google Meet was open previously, but is now closed:
        if (meetWasOpened) {
          console.log("Google Meet closed. Shutting down Whisper Screen.");
          app.quit(); // Automatically closes the app completely
        }
      }
    } catch (err) {
      // Ignore temporary scanning errors
    }
  }, 3000);
});
