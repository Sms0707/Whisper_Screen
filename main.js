const { app, BrowserWindow, desktopCapturer, session } = require('electron');
const activeWin = require('active-win');

let whisperWindow;

app.whenReady().then(() => {
  whisperWindow = new BrowserWindow({
    width: 400,
    height: 750,
    alwaysOnTop: true,
    show: false, // Stays hidden until Google Meet is active
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  whisperWindow.loadFile('index.html');

  // Handles screen sharing permissions smoothly in Electron
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch (error) {
      console.error("Screen capture error:", error);
    }
  });

  // Background Gateway: Pops up automatically when you are in a Google Meet tab
  setInterval(async () => {
    try {
      const currentWin = await activeWin();
      if (currentWin && currentWin.title) {
        // Detects if "Meet" is in your active window title
        const isMeetActive = currentWin.title.toLowerCase().includes('meet');

        if (isMeetActive) {
          if (whisperWindow && !whisperWindow.isVisible()) {
            whisperWindow.show(); // Automatically pops up over your meeting
          }
        }
      }
    } catch (err) {
      // Ignore background scanning hiccups
    }
  }, 2000);
});
