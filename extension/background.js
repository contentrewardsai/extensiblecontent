importScripts("config.js");

const STORAGE_KEY = "whop_auth";
const MESSAGE_TYPE = "WHOP_AUTH_SUCCESS";

function getAppOrigin() {
  return typeof APP_ORIGIN !== "undefined" ? APP_ORIGIN : "http://localhost:3000";
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "STORE_TOKENS") {
    const { tokens, user } = message;
    if (tokens && tokens.access_token) {
      chrome.storage.local.set({
        [STORAGE_KEY]: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_in: tokens.expires_in,
          obtained_at: tokens.obtained_at || Date.now(),
          user: user || {},
        },
      });
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: "Invalid tokens" });
    }
    return true;
  }
  if (message.type === "GET_TOKEN") {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
      const stored = data[STORAGE_KEY];
      if (!stored) {
        sendResponse({ token: null });
        return;
      }
      const expiresAt = stored.obtained_at + stored.expires_in * 1000;
      const needsRefresh = Date.now() > expiresAt - 5 * 60 * 1000;
      if (needsRefresh && stored.refresh_token) {
        fetch(`${getAppOrigin()}/api/extension/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: stored.refresh_token }),
        })
          .then((res) => res.json())
          .then((body) => {
            if (body.access_token) {
              const newStored = {
                access_token: body.access_token,
                refresh_token: body.refresh_token,
                expires_in: body.expires_in,
                obtained_at: body.obtained_at || Date.now(),
                user: stored.user,
              };
              chrome.storage.local.set({ [STORAGE_KEY]: newStored });
              sendResponse({ token: newStored.access_token });
            } else {
              chrome.storage.local.remove(STORAGE_KEY);
              sendResponse({ token: null });
            }
          })
          .catch(() => {
            sendResponse({ token: stored.access_token });
          });
      } else {
        sendResponse({ token: stored.access_token });
      }
    });
    return true;
  }
  if (message.type === "LOGOUT") {
    chrome.storage.local.remove(STORAGE_KEY);
    sendResponse({ success: true });
    return true;
  }
});
