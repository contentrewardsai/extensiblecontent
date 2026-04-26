const MESSAGE_TYPE = "WHOP_AUTH_SUCCESS";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || typeof data !== "object") return;

  if (data.type === MESSAGE_TYPE) {
    chrome.runtime.sendMessage(
      {
        type: "STORE_TOKENS",
        tokens: data.tokens,
        user: data.user,
      },
      () => {}
    );
    return;
  }

  if (data.type === "EC_GET_TOKEN" && typeof data.requestId === "string") {
    const requestId = data.requestId;
    try {
      chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (response) => {
        const token = response && response.token ? response.token : null;
        window.postMessage({ type: "EC_TOKEN", requestId, token }, "*");
      });
    } catch {
      window.postMessage({ type: "EC_TOKEN", requestId, token: null }, "*");
    }
    return;
  }

  if (data.type === "EC_LOGOUT" && typeof data.requestId === "string") {
    const requestId = data.requestId;
    try {
      chrome.runtime.sendMessage({ type: "LOGOUT" }, () => {
        window.postMessage({ type: "EC_LOGOUT_ACK", requestId }, "*");
      });
    } catch {
      window.postMessage({ type: "EC_LOGOUT_ACK", requestId }, "*");
    }
  }
});
