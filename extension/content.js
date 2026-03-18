const MESSAGE_TYPE = "WHOP_AUTH_SUCCESS";

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type === MESSAGE_TYPE) {
    chrome.runtime.sendMessage(
      {
        type: "STORE_TOKENS",
        tokens: event.data.tokens,
        user: event.data.user,
      },
      () => {}
    );
  }
});
