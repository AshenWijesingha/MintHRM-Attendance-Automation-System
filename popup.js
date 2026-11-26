const URL_ATT = 'https://limra.minthrm.com/dailyattendance/MyAttendance';
document.getElementById('open').onclick = () => { chrome.tabs.create({ url: URL_ATT }); window.close(); };
document.getElementById('show').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'afs-show' }, () => {
    if (chrome.runtime.lastError) document.getElementById('msg').textContent = 'Open the My Attendance page first.';
    else window.close();
  });
};
