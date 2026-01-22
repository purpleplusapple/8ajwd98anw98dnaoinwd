(function() {
    // Stealthy Monkey Patching
    const originalFetch = window.fetch;

    // Configurable state via window property or just listening to messages?
    // Since we are inside the page context, we can listen for window messages from content script.
    let isRecording = false;

    window.addEventListener('message', (event) => {
        if (event.data.source === 'VEO_EXTENSION_CONTENT' && event.data.type === 'SET_RECORDING') {
            isRecording = event.data.value;
            console.log('[Veo-Spy] Recording state:', isRecording);
        }
    });

    // Override fetch
    window.fetch = async function(...args) {
        if (isRecording) {
            try {
                const [resource, config] = args;
                // Clone headers and body if possible to avoid consuming streams
                // This is tricky for bodies (ReadableStream).
                // We'll try to clone the request if it is a Request object.

                let url = resource;
                let method = 'GET';
                let headers = {};
                let body = null;

                if (resource instanceof Request) {
                    url = resource.url;
                    method = resource.method;
                    headers = Object.fromEntries(resource.headers.entries());
                    // Body cloning is complex, skipping for brevity in this first pass or assuming simple config object usage
                } else {
                    url = resource.toString();
                    if (config) {
                        method = config.method || 'GET';
                        if (config.headers) {
                            headers = config.headers instanceof Headers
                                ? Object.fromEntries(config.headers.entries())
                                : config.headers;
                        }
                        body = config.body;
                    }
                }

                // If body is a string, we can capture it. If it's FormData, we might need to parse it.
                // For Veo, it likely sends JSON or FormData.

                // Notify content script
                window.postMessage({
                    source: 'VEO_EXTENSION_INJECTED',
                    type: 'FETCH_INTERCEPTED',
                    payload: {
                        url,
                        method,
                        headers,
                        body: body // This might be a string, or object.
                    }
                }, '*');

            } catch (err) {
                console.error('[Veo-Spy] Interception error:', err);
            }
        }

        return originalFetch.apply(this, args);
    };

    // Maintain prototype chain and enumerability to avoid detection
    // fetch is usually enumerable: true, configurable: true, writable: true on window
    // But let's check exact descriptors if we want to be super stealthy.
    // For now, simple assignment is usually enough for functional extensions unless heavy anti-bot.
    // To be safer:
    Object.defineProperty(window, 'fetch', {
        value: window.fetch,
        writable: true,
        enumerable: true,
        configurable: true
    });

    console.log('[Veo-Spy] Injected successfully.');

})();
