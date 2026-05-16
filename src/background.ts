chrome.runtime.onInstalled.addListener(() => {
  console.log("YouTube Lang Learn Extension Installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "LOOKUP_WORD") {
    const word = message.word;
    fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`)
      .then(res => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then(data => {
        const definition = data[0]?.meanings[0]?.definitions[0]?.definition || "No definition found.";
        sendResponse({ definition });
      })
      .catch(error => {
        sendResponse({ definition: "Definition not found." });
      });
    return true; // Keep message channel open for async response
  }
});
