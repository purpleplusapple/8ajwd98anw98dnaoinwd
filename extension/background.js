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

// Context Menus
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
    let bodyStructure = request.body;

    if (typeof bodyStructure === 'string') {
        try {
            bodyStructure = JSON.parse(bodyStructure);
        } catch (e) {
            // Not JSON
        }
    }

    function recursiveReplace(obj) {
        for (let key in obj) {
            if (typeof obj[key] === 'string') {
                if (key === 'prompt' || key === 'text') {
                    obj[key] = '{{PROMPT}}';
                }
                if (obj[key] === '16:9' || obj[key] === '9:16') {
                    obj[key] = '{{ASPECT_RATIO}}';
                }
            } else if (typeof obj[key] === 'object') {
                recursiveReplace(obj[key]);
            }
        }
    }

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
    pollingInterval = setInterval(pollForJobs, 5000);
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
        let resultUrl = null;

        const uploadTemplate = templates.find(t => t.type === 'UPLOAD_IMAGE');
        const generateTemplate = templates.find(t => t.type === 'GENERATE_VIDEO');

        let imageId = null;

        // 1. Upload Phase
        if (job.reference_image_path && uploadTemplate) {
            await delay(Math.random() * 2000 + 1000);

            const uploadRes = await executeTemplate(uploadTemplate, {
                imageBase64: job.imageBase64
            });

            // Assume the response contains an ID field
            imageId = uploadRes.id || uploadRes.file_id;
            console.log('Image uploaded, ID:', imageId);
        }

        // 2. Generate Phase
        if (generateTemplate) {
            await delay(Math.random() * 2000 + 1000);

            const generateRes = await executeTemplate(generateTemplate, {
                prompt: job.prompt,
                settings: job.settings,
                imageId: imageId
            });

            // Assume the response contains the video URL
            resultUrl = generateRes.url || generateRes.video_url;
            if (!resultUrl) throw new Error("No video URL found in response");
        } else {
             throw new Error("No generation template found");
        }

        // 3. Download & Save Phase
        console.log('Downloading result from:', resultUrl);
        const videoBlob = await fetch(resultUrl).then(r => {
            if (!r.ok) throw new Error(`Failed to download video: ${r.status}`);
            return r.blob();
        });

        const formData = new FormData();
        formData.append('jobId', job.id);
        formData.append('videoFile', videoBlob, `job-${job.id}.mp4`);

        await fetch(`${BACKEND_URL}/save`, {
            method: 'POST',
            body: formData
        });

        console.log('Job completed and saved.');

    } catch (err) {
        console.error('Job failed:', err);
        // Error reporting needs to match what backend expects for error
        // Backend expects JSON body with jobId and error
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
    let url = template.url;
    let body = template.body_structure;

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

    let requestBody = JSON.parse(JSON.stringify(body));
    replaceValues(requestBody);

    // Parse origin from template.url
    let origin;
    try {
        origin = new URL(url).origin;
    } catch (e) {
        throw new Error("Invalid template URL");
    }

    // Find a tab with this origin
    const tabs = await chrome.tabs.query({ url: `${origin}/*` });
    const targetTabId = tabs[0]?.id;

    if (!targetTabId) throw new Error(`No open tab found for ${origin}. Please open the Veo site.`);

    const result = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: injectedFetch,
        args: [url, template.method, template.headers, requestBody]
    });

    return result[0].result;
}

async function injectedFetch(url, method, headers, body) {
    try {
        const options = {
            method: method,
            headers: headers,
        };

        if (body && typeof body === 'object') {
            const isJson = Object.keys(headers).some(k => k.toLowerCase() === 'content-type' && headers[k].includes('json'));
            if (isJson) {
                options.body = JSON.stringify(body);
            } else {
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
