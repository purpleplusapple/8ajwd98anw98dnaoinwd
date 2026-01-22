// Inject the spy script
const s = document.createElement('script');
s.src = chrome.runtime.getURL('injected.js');
s.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(s);

// Relay messages from Injected Script to Background
window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'VEO_EXTENSION_INJECTED') {
        return;
    }

    if (event.data.type === 'FETCH_INTERCEPTED') {
        chrome.runtime.sendMessage({
            type: 'CAPTURED_REQUEST',
            payload: event.data.payload
        });
    }
});

// Relay messages from Background to Injected Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SET_RECORDING') {
        window.postMessage({
            source: 'VEO_EXTENSION_CONTENT',
            type: 'SET_RECORDING',
            value: request.value
        }, '*');
    }
});
