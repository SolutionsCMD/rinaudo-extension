// Popup: shows connect state and (dis)connects via the service worker. Builds
// DOM with textContent — never innerHTML with dynamic content.
const $ = (id) => document.getElementById(id);

async function refresh() {
  const { connected } = await chrome.runtime.sendMessage({ type: 'authState' });
  const status = $('status');
  const action = $('action');
  status.replaceChildren();
  if (connected) {
    const ok = document.createElement('span');
    ok.className = 'ok';
    ok.textContent = 'Connected';
    status.append(ok, ". You'll get an alert when a poll opens, and the vote card pops up on Mizkif's stream.");
    action.textContent = 'Disconnect';
    action.className = 'disconnect';
    action.dataset.act = 'disconnect';
  } else {
    status.textContent = 'Connect once with Kick to vote on live polls and get alerts.';
    action.textContent = 'Connect with Kick';
    action.className = 'connect';
    action.dataset.act = 'connect';
  }
}

$('action').addEventListener('click', async () => {
  const action = $('action');
  action.disabled = true;
  await chrome.runtime.sendMessage({ type: action.dataset.act === 'disconnect' ? 'disconnect' : 'connect' });
  action.disabled = false;
  refresh();
});

refresh();
