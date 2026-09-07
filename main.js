const { app, BrowserWindow, desktopCapturer, session, globalShortcut, ipcMain } = require('electron');

// Force Chromium to allow text-to-speech without extra user gestures
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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

  // Prevents the overlay window from being captured in screen shares
  whisperWindow.setContentProtection(true);
  whisperWindow.loadFile('index.html');

  globalShortcut.register('CommandOrControl+Shift+W', () => {
    if (whisperWindow.isVisible()) {
      whisperWindow.hide();
      userDismissedCurrentMeeting = true;
    } else {
      whisperWindow.show();
      userDismissedCurrentMeeting = false; 
    }
  });

  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    if (whisperWindow) {
      whisperWindow.webContents.executeJavaScript('window.speechSynthesis.cancel();');
    }
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (whisperWindow) {
      whisperWindow.webContents.executeJavaScript('const btn = document.querySelector(".entry .replay"); if(btn) btn.click();');
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
        if (missingMeetingCount > 5) {
          if (whisperWindow && whisperWindow.isVisible()) {
            whisperWindow.hide();
          }
          meetingDetectedOnce = false;
          userDismissedCurrentMeeting = false; 
        }
      }
    } catch (err) {}
  }, 2000);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
