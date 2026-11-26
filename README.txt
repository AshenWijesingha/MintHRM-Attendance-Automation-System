MintHRM Attendance Automation System  v2.1  (Chrome / Edge / Brave)
===================================================================
Full documentation:
https://github.com/AshenWijesingha/MintHRM-Attendance-Automation-System

INSTALL
1. Unzip the downloaded file. You get a folder called "minthrm-attendance-automation".
   Keep this folder somewhere permanent - the browser loads the extension from it.
2. Open chrome://extensions  (Edge: edge://extensions, Brave: brave://extensions)
3. Turn on "Developer mode" (top right; in Edge it is on the left).
4. Click "Load unpacked" and select the "minthrm-attendance-automation" folder.
   (Remove the old "Attendance Auto-Fill" extension first. Settings and reasons start fresh.)
5. Optional: pin the extension from the puzzle-piece menu in the toolbar.

UPDATE
Unzip the new version over the same folder, then click the reload button on the
extension's card in chrome://extensions. Your reasons and settings are kept.

USE
Open Self > Manage My Attendance. The Attendance Automation System panel appears bottom-right.

  SUBMIT tab
   - In / Out time (default 09:00 and 17:30)
   - Reason: choose from your saved reasons (the default is pre-selected)
   - Preview: lists every day that would be submitted. Nothing is saved.
   - Fill & Submit All: scans all pages, then submits each day one by one,
     with a progress bar and Submitted / Skipped / Failed counters.
     Click a counter to filter the log. "Copy log" copies the result.
   - Stop: halts after the current step.

  REASONS tab
   - Add a reason, click * to make it the default, click a reason (or the pencil) to rename it,
     X to delete. Your list and default are remembered.

  OPTIONS tab
   - Date range (or quick picks: Last 7 days / This month / Last month / Use page's range)
   - Keep real fingerprint punches (on): only missing times are filled
   - Skip holidays & leave days (on)
   - Speed: pause between steps
   - Reset everything to defaults

  Minimise with "-". The panel becomes a small pill you can drag anywhere.
  The toolbar icon has "Open My Attendance page" and "Show panel".

ALWAYS SKIPPED
 - Off days ("No shift listed")
 - Days that already have a pending change request

Each entry is a normal change request and goes to your approver.
Always run Preview first and check the list before you submit.
