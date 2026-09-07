const { app, BrowserWindow, desktopCapturer, session, ipcMain, globalShortcut } = require('electron');

let whisperWindow;
let meetingDetectedOnce = false;
let missingMeetingCount = 0;
let userDismissedCurrentMeeting = false;

const MEETING_KEYWORDS = ['meet - ', 'zoom meeting', 'teams meeting', 'cisco webex', 'webex meeting'];

app.whenReady().then(() => {
  whisperWindow = new BrowserWindow({
    width: 900,
    height: 420,
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

  // Helper function to handle toggle show/hide & activate/deactivate
  function toggleWhisperState() {
    if (!whisperWindow || whisperWindow.isDestroyed()) return;

    if (whisperWindow.isVisible()) {
      userDismissedCurrentMeeting = true;
      whisperWindow.webContents.send('deactivate-whisper');
    } else {
      whisperWindow.show();
      userDismissedCurrentMeeting = false; 
      whisperWindow.webContents.send('activate-whisper');
    }
  }

  // 1. IN-WINDOW KEYBOARD INTERCEPTOR (Direct listener fallback)
  whisperWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isCtrlOrCmd = input.control || input.meta;

    // Ctrl + Shift + Q -> Instant Silence
    if (isCtrlOrCmd && input.shift && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      whisperWindow.webContents.send('trigger-silence');
    }

    // Ctrl + Shift + W -> Toggle Activate / Deactivate
    if (isCtrlOrCmd && input.shift && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      toggleWhisperState();
    }
  });

  // 2. GLOBAL SHORTCUTS
  try {
    globalShortcut.register('CommandOrControl+Shift+W', toggleWhisperState);
  } catch (e) {
    console.warn("Could not register global Ctrl+Shift+W");
  }

  // Global Silence Shortcut with Alt+Shift+Q Fallback
  try {
    globalShortcut.register('CommandOrControl+Shift+Q', () => {
      if (whisperWindow && !whisperWindow.isDestroyed()) {
        whisperWindow.webContents.send('trigger-silence');
      }
    });
  } catch (e) {
    console.warn("Could not register global Ctrl+Shift+Q");
  }

  try {
    globalShortcut.register('Alt+Shift+Q', () => {
      if (whisperWindow && !whisperWindow.isDestroyed()) {
        whisperWindow.webContents.send('trigger-silence');
      }
    });
  } catch (e) {}

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch (error) {
      console.error("Display media request error:", error);
    }
  });

  // UI Dismiss Button Event
  ipcMain.on('close-overlay', () => {
    userDismissedCurrentMeeting = true;
    if (whisperWindow && !whisperWindow.isDestroyed()) {
      whisperWindow.webContents.send('deactivate-whisper');
    }
  });

  // Received from script.js after "Whisper deactivated" voice cue finishes
  ipcMain.on('hide-window-now', () => {
    if (whisperWindow && !whisperWindow.isDestroyed()) {
      whisperWindow.hide();
    }
  });

  // 3. SMART SCANNER LOOP
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
          whisperWindow.webContents.send('activate-whisper');
        }
      } else if (meetingDetectedOnce) {
        missingMeetingCount++;
        if (missingMeetingCount > 5) {
          if (whisperWindow && whisperWindow.isVisible()) {
            whisperWindow.webContents.send('deactivate-whisper');
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

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
