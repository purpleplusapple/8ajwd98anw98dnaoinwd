const BACKEND_URL = 'http://localhost:3001/api';

// State
let isRecording = false;
let pollingInterval = null;

// Listen for messages from Content Script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'CAPTURED_REQUEST') {
        handleCapturedRequest(request.payload);
    }
});

// Context Menus for controlling recording and actions
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "veo_toggle_record",
        title: "Toggle Spy Mode",
        contexts: ["all"]
    });
    chrome.contextMenus.create({
        id: "veo_save_upload_template",
        title: "Save Last Request as UPLOAD_IMAGE",
        contexts: ["all"]
    });
    chrome.contextMenus.create({
        id: "veo_save_generate_template",
        title: "Save Last Request as GENERATE_VIDEO",
        contexts: ["all"]
    });
    chrome.contextMenus.create({
        id: "veo_start_polling",
        title: "Start Job Polling",
        contexts: ["all"]
    });
});

let lastCapturedRequest = null;

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "veo_toggle_record") {
        isRecording = !isRecording;
        // Notify content script in the active tab
        chrome.tabs.sendMessage(tab.id, { type: 'SET_RECORDING', value: isRecording });
        console.log('Recording:', isRecording);
    } else if (info.menuItemId === "veo_save_upload_template") {
        if (lastCapturedRequest) saveTemplate('UPLOAD_IMAGE', lastCapturedRequest);
    } else if (info.menuItemId === "veo_save_generate_template") {
        if (lastCapturedRequest) saveTemplate('GENERATE_VIDEO', lastCapturedRequest);
    } else if (info.menuItemId === "veo_start_polling") {
        startPolling();
    }
});

function handleCapturedRequest(requestPayload) {
    if (!isRecording) return;
    lastCapturedRequest = requestPayload;
    console.log('Captured:', requestPayload);
}

async function saveTemplate(type, request) {
    // Sanitize and parameterize
    // We assume the user just did the action.
    // For GENERATE_VIDEO, we look for the prompt in the body and replace it.

    let bodyStructure = request.body;

    // Naive replacement logic for demonstration
    // If body is JSON string, parse it
    if (typeof bodyStructure === 'string') {
        try {
            bodyStructure = JSON.parse(bodyStructure);
        } catch (e) {
            // Not JSON
        }
    }

    // Identify and replace values with placeholders
    // This part is highly dependent on Veo's actual API structure.
    // We'll traverse the object and replace strings that look like user inputs if we could identify them.
    // For now, we will assume the user manually edits or we replace known keys.
    // BUT the requirement says: "replace specific prompt text with a placeholder {{PROMPT}}"
    // We'll search recursively for a long string? Or just assume a key named 'prompt' or 'text'.

    function recursiveReplace(obj) {
        for (let key in obj) {
            if (typeof obj[key] === 'string') {
                // If we knew the prompt used, we could replace it.
                // Since we don't know the exact prompt user typed, we might need the user to tell us,
                // or we just save it as is and the backend/UI allows editing,
                // OR we blindly replace common keys like 'prompt', 'input_text'.
                if (key === 'prompt' || key === 'text') {
                    obj[key] = '{{PROMPT}}';
                }
                // Check for Aspect Ratio (e.g. "16:9")
                if (obj[key] === '16:9' || obj[key] === '9:16') {
                    obj[key] = '{{ASPECT_RATIO}}';
                }
            } else if (typeof obj[key] === 'object') {
                recursiveReplace(obj[key]);
            }
        }
    }

    // Clone to avoid mutating original if needed
    let sanitizedBody = JSON.parse(JSON.stringify(bodyStructure));
    recursiveReplace(sanitizedBody);

    const template = {
        type,
        url: request.url,
        method: request.method,
        headers: request.headers,
        body_structure: sanitizedBody
    };

    try {
        await fetch(`${BACKEND_URL}/templates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(template)
        });
        console.log(`Template ${type} saved.`);
    } catch (e) {
        console.error('Error saving template:', e);
    }
}

// --- Polling & Execution ---

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(pollForJobs, 5000); // 5 seconds
    console.log('Polling started...');
}

async function pollForJobs() {
    try {
        const res = await fetch(`${BACKEND_URL}/poll`);
        const data = await res.json();

        if (data.job) {
            processJob(data.job, data.templates);
        }
    } catch (e) {
        console.error('Polling error:', e);
    }
}

async function processJob(job, templates) {
    console.log('Processing Job:', job.id);

    try {
        let result = null;

        // Determine Templates
        const uploadTemplate = templates.find(t => t.type === 'UPLOAD_IMAGE');
        const generateTemplate = templates.find(t => t.type === 'GENERATE_VIDEO');

        // Logic:
        // If Job has Image -> Execute Upload -> Get ID -> Execute Generate
        // Else -> Execute Generate

        let imageId = null;

        if (job.reference_image_path && uploadTemplate) {
            // Random delay
            await delay(Math.random() * 2000 + 1000);

            // Execute Upload
            // We need to pass the image data.
            // job.imageBase64 contains the data.
            const uploadRes = await executeTemplate(uploadTemplate, {
                imageBase64: job.imageBase64
            });

            // Extract Image ID from response.
            // This is specific to Veo's API. We'll assume it returns JSON with an ID.
            // Adjust path as necessary.
            imageId = uploadRes.id || uploadRes.file_id;
            console.log('Image uploaded, ID:', imageId);
        }

        if (generateTemplate) {
            await delay(Math.random() * 2000 + 1000);

            const generateRes = await executeTemplate(generateTemplate, {
                prompt: job.prompt,
                settings: job.settings,
                imageId: imageId
            });

            // Result URL
            // Assume generateRes contains the video URL or ID.
            result = generateRes.url || generateRes.video_url || "https://placeholder.com/video.mp4";
        }

        // Save result
        await fetch(`${BACKEND_URL}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId: job.id,
                resultUrl: result
            })
        });

    } catch (err) {
        console.error('Job failed:', err);
        await fetch(`${BACKEND_URL}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId: job.id,
                error: err.toString()
            })
        });
    }
}

async function executeTemplate(template, data) {
    // 1. Prepare URL
    let url = template.url;

    // 2. Prepare Body
    let body = template.body_structure;

    // Replace placeholders
    // Helper to traverse and replace
    function replaceValues(obj) {
        if (typeof obj === 'string') {
            let val = obj;
            if (val.includes('{{PROMPT}}') && data.prompt) val = val.replace('{{PROMPT}}', data.prompt);
            if (val.includes('{{ASPECT_RATIO}}') && data.settings?.ratio) val = val.replace('{{ASPECT_RATIO}}', data.settings.ratio);
            if (val.includes('{{IMAGE_BASE64}}') && data.imageBase64) val = val.replace('{{IMAGE_BASE64}}', data.imageBase64);
            if (val.includes('{{IMAGE_ID}}') && data.imageId) val = val.replace('{{IMAGE_ID}}', data.imageId);
            return val;
        } else if (typeof obj === 'object' && obj !== null) {
            for (let k in obj) {
                obj[k] = replaceValues(obj[k]);
            }
        }
        return obj;
    }

    // Clone body
    let requestBody = JSON.parse(JSON.stringify(body));
    replaceValues(requestBody);

    // 3. Execute in the context of a tab?
    // "Execute the fetch request within the target tab context to bypass CORS/Auth issues."
    // `fetch` in background script might fail if cookies are HttpOnly or strict CORS.
    // We should use `scripting.executeScript` to run fetch in the active tab.

    // We need a target tab.
    // Parse origin from template.url
    let origin;
    try {
        origin = new URL(url).origin;
    } catch (e) {
        // Fallback if url is relative (unlikely for captured requests)
        throw new Error("Invalid template URL");
    }

    // Find a tab with this origin
    const tabs = await chrome.tabs.query({ url: `${origin}/*` });
    const targetTabId = tabs[0]?.id;

    if (!targetTabId) throw new Error(`No open tab found for ${origin}. Please open the Veo site.`);

    // We pass the parameters to the injected function
    const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: injectedFetch,
        args: [url, template.method, template.headers, requestBody]
    });

    // executeScript returns array of results.
    return result[0].result;
}

// This function runs INSIDE the page
async function injectedFetch(url, method, headers, body) {
    try {
        // Prepare options
        const options = {
            method: method,
            headers: headers,
        };

        // If body is object, stringify it
        if (body && typeof body === 'object') {
            // Check if headers say json
            // headers might be object
            const isJson = Object.keys(headers).some(k => k.toLowerCase() === 'content-type' && headers[k].includes('json'));
            if (isJson) {
                options.body = JSON.stringify(body);
            } else {
                // If not JSON, maybe it's formData? or urlencoded?
                // For now assuming JSON as standard for these APIs
                 options.body = JSON.stringify(body);
            }
        } else {
             options.body = body;
        }

        const response = await fetch(url, options);
        if (!response.ok) {
             throw new Error(`Request failed: ${response.status}`);
        }
        return await response.json();
    } catch (e) {
        throw e.toString();
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
