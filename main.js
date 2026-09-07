const { app, BrowserWindow, desktopCapturer, session } = require('electron');

let whisperWindow;
let meetDetectedOnce = false;
let missingMeetCount = 0;

app.whenReady().then(() => {
  whisperWindow = new BrowserWindow({
    width: 400,
    height: 750,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  whisperWindow.loadFile('index.html');

  // Enable the native share picker so you can choose the exact Meet tab/window
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    // Left empty because useSystemPicker handles the interactive dialog box
  }, { useSystemPicker: true });

  // Robust background checker that doesn't break when Whisper Screen is focused
  setInterval(async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window'] });
      const isMeetOpen = sources.some(s => s.name && s.name.toLowerCase().includes('meet'));

      if (isMeetOpen) {
        meetDetectedOnce = true;
        missingMeetCount = 0; // Reset counter while Meet is open
        if (whisperWindow && !whisperWindow.isVisible()) {
          whisperWindow.show(); // Automatically pops up over Google Meet
        }
      } else if (meetDetectedOnce) {
        missingMeetCount++;
        // Only shut down if Google Meet has been closed for more than 10 seconds
        if (missingMeetCount > 5) {
          console.log("Google Meet closed. Shutting down Whisper Screen.");
          app.quit();
        }
      }
    } catch (err) {
      // Ignore background scan errors
    }
  }, 2000);
});
