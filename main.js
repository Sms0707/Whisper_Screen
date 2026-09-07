const { app, BrowserWindow, desktopCapturer, session, ipcMain, globalShortcut } = require('electron');

let whisperWindow;
let meetingDetectedOnce = false;
let missingMeetingCount = 0;
let userDismissedCurrentMeeting = false; // <-- NEW: Remembers if you hid it!

const MEETING_KEYWORDS = ['meet - ', 'zoom meeting', 'teams meeting', 'cisco webex', 'webex meeting'];

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

  // 1. GLOBAL SHORTCUT: Press Ctrl+Shift+W to manually hide or show the AI anytime!
  // 1. GLOBAL SHORTCUT: Press Ctrl+Shift+W to manually hide or show the AI
  globalShortcut.register('CommandOrControl+Shift+W', () => {
    if (whisperWindow.isVisible()) {
      whisperWindow.hide();
      userDismissedCurrentMeeting = true;
      whisperWindow.webContents.send('whisper-status', 'deactivated'); // <--- NEW
    } else {
      whisperWindow.show();
      userDismissedCurrentMeeting = false; 
      whisperWindow.webContents.send('whisper-status', 'activated'); // <--- NEW
    }
  });
  // GLOBAL SHORTCUT: Press Ctrl+Shift+Q to instantly silence the AI
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    if (whisperWindow) {
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

  // 2. LISTEN FOR UI BUTTON: Hides the window when 'Dismiss' is clicked
  ipcMain.on('close-overlay', () => {
    whisperWindow.hide();
    userDismissedCurrentMeeting = true;
  });

  // 3. SMART SCANNER: Auto-starts, but respects your privacy if you dismiss it
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
        
        // Auto-pops up ONLY if you haven't explicitly dismissed it for this meeting
        if (whisperWindow && !whisperWindow.isVisible() && !userDismissedCurrentMeeting) {
          whisperWindow.show();
          whisperWindow.webContents.send('whisper-status', 'activated');
        }
      } else if (meetingDetectedOnce) {
        missingMeetingCount++;
        if (missingMeetingCount > 5) {
          if (whisperWindow && whisperWindow.isVisible()) {
            whisperWindow.hide();
            whisperWindow.webContents.send('whisper-status', 'deactivated');
          }
          // The meeting is officially over! 
          // Reset the flags so the app will auto-open for your NEXT meeting.
          meetingDetectedOnce = false;
          userDismissedCurrentMeeting = false; 
        }
      }
    } catch (err) {
      // Ignore scanner errors
    }
  }, 2000);
});

// Clean up shortcuts when app closes
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
