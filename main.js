const { app, BrowserWindow, desktopCapturer, session, globalShortcut } = require('electron');

let whisperWindow;
let meetingDetectedOnce = false;
let missingMeetingCount = 0;
let userDismissedCurrentMeeting = false;

// Keywords used to detect active meeting windows
const MEETING_KEYWORDS = ['meet - ', 'zoom meeting', 'teams meeting', 'cisco webex', 'webex meeting'];

app.whenReady().then(() => {
  whisperWindow = new BrowserWindow({
    width: 860,
    height: 420,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    show: false, // Hidden until a meeting starts
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  whisperWindow.loadFile('index.html');

  // ==========================================
  // GLOBAL ACCESSIBILITY SHORTCUTS
  // ==========================================
  
  // 1. HIDE/SHOW: Press Ctrl+Shift+W to toggle UI
  globalShortcut.register('CommandOrControl+Shift+W', () => {
    if (whisperWindow.isVisible()) {
      whisperWindow.hide();
      userDismissedCurrentMeeting = true;
    } else {
      whisperWindow.show();
      userDismissedCurrentMeeting = false; 
    }
  });

  // 2. PANIC MUTE: Press Ctrl+Shift+Q to instantly stop the AI voice
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    if (whisperWindow) {
      whisperWindow.webContents.executeJavaScript('document.getElementById("silenceBtn").click();');
    }
  });

  // 3. REPLAY: Press Ctrl+Shift+R to repeat the last visual description aloud
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (whisperWindow) {
      whisperWindow.webContents.send('trigger-replay');
    }
  });

  // ==========================================
  // SCREEN CAPTURE & MEETING DETECTION
  // ==========================================

  // Automatically fetch screen sharing sources without prompting
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
        
        // Auto-show ONLY if the user hasn't explicitly dismissed it for this specific meeting
        if (whisperWindow && !whisperWindow.isVisible() && !userDismissedCurrentMeeting) {
          whisperWindow.show();
        }
      } else if (meetingDetectedOnce) {
        missingMeetingCount++;
        
        // If meeting is missing for ~10 seconds, hide the app and reset state
        if (missingMeetingCount > 5) {
          if (whisperWindow && whisperWindow.isVisible()) {
            whisperWindow.hide();
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

// Clean up all global shortcuts when the app closes
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
