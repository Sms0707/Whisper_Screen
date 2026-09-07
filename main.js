const { app, BrowserWindow, desktopCapturer, session, ipcMain, globalShortcut } = require('electron');

let whisperWindow;
let meetingDetectedOnce = false;
let missingMeetingCount = 0;
let userDismissedCurrentMeeting = false;

const MEETING_KEYWORDS = ['meet - ', 'zoom meeting', 'teams meeting', 'cisco webex', 'webex meeting'];

// Helper: Safely signals script.js to cancel all active TTS audio & video streams before hiding
function forceStopAndHideWindow() {
  if (whisperWindow && !whisperWindow.isDestroyed()) {
    whisperWindow.webContents.send('force-stop-capture');
    whisperWindow.hide();
  }
}

app.whenReady().then(() => {
  whisperWindow = new BrowserWindow({
    width: 900,
    height: 400,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  whisperWindow.loadFile('index.html');

  // 1. GLOBAL SHORTCUT: Ctrl+Shift+W toggles show/hide and kills voice immediately on hide
  globalShortcut.register('CommandOrControl+Shift+W', () => {
    if (whisperWindow.isVisible()) {
      userDismissedCurrentMeeting = true;
      forceStopAndHideWindow();
    } else {
      whisperWindow.show();
      userDismissedCurrentMeeting = false; 
      whisperWindow.webContents.send('whisper-status', 'activated');
    }
  });

  // GLOBAL SHORTCUT: Ctrl+Shift+Q instantly silences active TTS speech
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    if (whisperWindow && !whisperWindow.isDestroyed()) {
      whisperWindow.webContents.send('trigger-silence');
    }
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch (error) {
      console.error("Display media request error:", error);
    }
  });

  // 2. LISTEN FOR UI BUTTON: Kills audio and hides overlay when close button is clicked
  ipcMain.on('close-overlay', () => {
    userDismissedCurrentMeeting = true;
    forceStopAndHideWindow();
  });

  // 3. SMART SCANNER: Auto-shows and auto-hides based on active meeting windows
  setInterval(async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window'] });
      
      const isMeetingOpen = sources.some(s => {
        if (!s.name) return false;
        return MEETING_KEYWORDS.some(keyword => s.name.toLowerCase().includes(keyword));
      });

      if (isMeetingOpen) {
        meetingDetectedOnce = true;
        missingMeetingCount = 0;
        
        if (whisperWindow && !whisperWindow.isVisible() && !userDismissedCurrentMeeting) {
          whisperWindow.show();
          whisperWindow.webContents.send('whisper-status', 'activated');
        }
      } else if (meetingDetectedOnce) {
        missingMeetingCount++;
        if (missingMeetingCount > 5) {
          if (whisperWindow && whisperWindow.isVisible()) {
            forceStopAndHideWindow();
          }
          meetingDetectedOnce = false;
          userDismissedCurrentMeeting = false; 
        }
      }
    } catch (err) {
      // Ignore scanner errors
    }
  }, 2000);
});

// Clean up shortcuts on application exit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
