function getAppOrigin() {
  if (typeof APP_ORIGIN !== "undefined") return APP_ORIGIN;
  return "http://localhost:3000";
}

function updateUI(stored) {
  const loggedOut = document.getElementById("logged-out");
  const loggedIn = document.getElementById("logged-in");
  const userEmail = document.getElementById("user-email");
  if (stored && stored.access_token) {
    loggedOut.classList.add("hidden");
    loggedIn.classList.remove("hidden");
    userEmail.textContent = stored.user?.email || "Signed in";
  } else {
    loggedOut.classList.remove("hidden");
    loggedIn.classList.add("hidden");
  }
}

function refreshUI() {
  chrome.storage.local.get("whop_auth", (data) => {
    updateUI(data.whop_auth);
  });
}

refreshUI();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.whop_auth) refreshUI();
});

document.getElementById("login-btn").addEventListener("click", () => {
  const url = `${getAppOrigin()}/extension/login`;
  chrome.tabs.create({ url });
  window.close();
});

document.getElementById("social-btn").addEventListener("click", () => {
  const url = `${getAppOrigin()}/extension/social`;
  chrome.tabs.create({ url });
  window.close();
});

document.getElementById("logout-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "LOGOUT" }, () => {
    updateUI(null);
  });
});
