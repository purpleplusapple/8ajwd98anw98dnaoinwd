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

    // Proxy function
    const proxyFetch = async function(...args) {
        if (isRecording) {
            try {
                const [resource, config] = args;

                let url = resource;
                let method = 'GET';
                let headers = {};
                let body = null;

                if (resource instanceof Request) {
                    url = resource.url;
                    method = resource.method;
                    headers = Object.fromEntries(resource.headers.entries());
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

                // Notify content script
                window.postMessage({
                    source: 'VEO_EXTENSION_INJECTED',
                    type: 'FETCH_INTERCEPTED',
                    payload: {
                        url,
                        method,
                        headers,
                        body: body
                    }
                }, '*');

            } catch (err) {
                console.error('[Veo-Spy] Interception error:', err);
            }
        }

        return originalFetch.apply(this, args);
    };

    // Anti-Detection: Override toString to return native code string
    proxyFetch.toString = function() {
        return "function fetch() { [native code] }";
    };

    // Maintain prototype chain and enumerability to avoid detection
    Object.defineProperty(window, 'fetch', {
        value: proxyFetch,
        writable: true,
        enumerable: true,
        configurable: true
    });

    console.log('[Veo-Spy] Injected successfully.');

})();
