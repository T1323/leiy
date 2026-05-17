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

  if (message.action === "TRANSLATE_BATCH") {
    const texts = message.texts; // Array of strings
    if (!texts || texts.length === 0) {
      sendResponse({ translatedTexts: [] });
      return true;
    }

    const separator = "\n";
    const combinedText = texts.join(separator);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${encodeURIComponent(combinedText)}`;

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error("Translation failed");
        return res.json();
      })
      .then(data => {
        // data[0] contains an array of translated segments: [[translated, original, ...], ...]
        let fullTranslatedString = "";
        if (data && data[0]) {
          for (const segment of data[0]) {
            if (segment[0]) fullTranslatedString += segment[0];
          }
        }
        
        // Split back into array
        // The translation API might sometimes mess up newlines, but usually it preserves them
        const translatedArray = fullTranslatedString.split('\n').map(t => t.trim());
        
        // Ensure same length, pad with empty strings if necessary
        while (translatedArray.length < texts.length) translatedArray.push("");
        // If it got extra splits, just slice to match original length
        
        sendResponse({ translatedTexts: translatedArray.slice(0, texts.length) });
      })
      .catch(err => {
        console.error("YT Lang Learn: API Translation Error", err);
        sendResponse({ translatedTexts: texts.map(() => "") }); // Return empty on fail
      });
      
    return true;
  }
});
