const { app, BrowserWindow, desktopCapturer, session, globalShortcut, ipcMain } = require('electron');

let whisperWindow;
let meetingDetectedOnce = false;
let missingMeetingCount = 0;
let userDismissedCurrentMeeting = false;

const MEETING_KEYWORDS = ['meet - ', 'zoom meeting', 'teams meeting', 'cisco webex', 'webex meeting'];

app.whenReady().then(() => {
  whisperWindow = new BrowserWindow({
    width: 860,
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

  whisperWindow.setContentProtection(true);
  whisperWindow.loadFile('index.html');

  // Global Shortcuts
  globalShortcut.register('CommandOrControl+Shift+W', () => {
    if (whisperWindow.isVisible()) {
      whisperWindow.webContents.send('force-stop-capture');
      whisperWindow.hide();
      userDismissedCurrentMeeting = true;
    } else {
      whisperWindow.show();
      userDismissedCurrentMeeting = false; 
    }
  });

  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    if (whisperWindow) {
      whisperWindow.webContents.send('trigger-silence');
    }
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (whisperWindow) {
      whisperWindow.webContents.send('trigger-replay');
    }
  });

  // Handle explicit close button click from renderer UI
  ipcMain.on('close-overlay', () => {
    if (whisperWindow) {
      whisperWindow.webContents.send('force-stop-capture');
      whisperWindow.hide();
    }
    userDismissedCurrentMeeting = true;
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch (error) {
      console.error("Display media request error:", error);
    }
  });

  // Background Meeting Scanner Loop
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
        }
      } else if (meetingDetectedOnce) {
        missingMeetingCount++;
        
        // Meeting closed: forcibly kill speech audio and stop screen recording loops
        if (missingMeetingCount > 5) {
          if (whisperWindow) {
            whisperWindow.webContents.send('force-stop-capture');
            if (whisperWindow.isVisible()) {
              whisperWindow.hide();
            }
          }
          meetingDetectedOnce = false;
          userDismissedCurrentMeeting = false; 
        }
      }
    } catch (err) {
      // Ignore background scan errors
    }
  }, 2000);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
