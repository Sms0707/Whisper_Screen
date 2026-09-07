const { app, BrowserWindow, desktopCapturer, session } = require('electron');
const activeWin = require('active-win');

let whisperWindow;

app.whenReady().then(() => {
  whisperWindow = new BrowserWindow({
    width: 400,
    height: 750,
    alwaysOnTop: true,
    show: false, // Stays hidden in the background until Google Meet opens
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  whisperWindow.loadFile('index.html');

  // FIX: This tells Electron how to handle screen sharing requests automatically
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      // Automatically select the primary screen/window for capture
      callback({ video: sources[0], audio: 'loopback' });
    }).catch((error) => {
      console.error("Screen capture error:", error);
    });
  });

  // Background Gateway Detection Loop
  setInterval(async () => {
    try {
      const currentWindow = await activeWin();
      if (currentWindow && currentWindow.title && currentWindow.title.includes('Google Meet')) {
        if (whisperWindow && !whisperWindow.isVisible()) {
          whisperWindow.show(); // Automatically pops up over Google Meet!
        }
      }
    } catch (err) {
      // Ignored if window check fails temporarily
    }
  }, 2000);
});
