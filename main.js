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

  // Automatically and reliably handle screen sharing requests without crashing
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      
      // Automatically target the Google Meet or browser window, fallback to primary screen
      const targetSource = sources.find(s => s.name && (s.name.toLowerCase().includes('meet') || s.name.toLowerCase().includes('chrome'))) || sources[0];
      
      callback({ video: targetSource, audio: 'loopback' });
    } catch (error) {
      console.error("Display media request error:", error);
    }
  });

  // Background gateway detector
  setInterval(async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window'] });
      const isMeetOpen = sources.some(s => s.name && s.name.toLowerCase().includes('meet'));

      if (isMeetOpen) {
        meetDetectedOnce = true;
        missingMeetCount = 0;
        if (whisperWindow && !whisperWindow.isVisible()) {
          whisperWindow.show();
        }
      } else if (meetDetectedOnce) {
        missingMeetCount++;
        if (missingMeetCount > 5) {
          app.quit();
        }
      }
    } catch (err) {
      // Ignore background scan errors
    }
  }, 2000);
});
