// wrong_sync.js – cross‑device wrong question sync with compression & tombstone merge
// Now uses same folder structure as sync.js: wq_sync/user<id>/state.json
const WQ_BUCKET_API = 'https://quiz-app-bucket-1428146716.cos.ap-hongkong.myqcloud.com';
const WQ_FOLDER = 'wq_sync';
const WQ_LOCAL_KEY = 'wrong_questions';

// ---------- Compression helpers (with pako fallback) ----------
function isPakoAvailable() {
    return typeof pako !== 'undefined' && pako && typeof pako.deflate === 'function';
}

function compressData(data) {
    if (!isPakoAvailable()) {
        console.warn('[wrong_sync] pako not loaded – storing uncompressed');
        return null;
    }
    try {
        const jsonStr = JSON.stringify(data);
        const compressed = pako.deflate(jsonStr, { level: 6 });
        return compressed;
    } catch (e) {
        console.error('[wrong_sync] compression failed', e);
        return null;
    }
}

function decompressData(compressed) {
    if (!isPakoAvailable()) {
        throw new Error('pako missing');
    }
    try {
        const jsonStr = pako.inflate(compressed, { to: 'string' });
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('[wrong_sync] decompression failed', e);
        throw e;
    }
}

// ---------- localStorage read/write with compression detection ----------
function getWrongLocal() {
    const raw = localStorage.getItem(WQ_LOCAL_KEY);
    if (!raw) return [];

    try {
        let arr;
        if (raw.startsWith('[') && !raw.startsWith('[{')) {
            const compressedArray = JSON.parse(raw);
            const compressed = new Uint8Array(compressedArray);
            arr = decompressData(compressed);
        } else {
            arr = JSON.parse(raw);
        }
        if (!Array.isArray(arr)) arr = [];
        return migrateWrongList(arr);
    } catch (e) {
        console.error('[wrong_sync] failed to read wrong_questions', e);
        return [];
    }
}

function setWrongLocal(arr) {
    if (!Array.isArray(arr)) arr = [];
    try {
        const compressed = compressData(arr);
        if (compressed !== null) {
            const compressedArray = Array.from(compressed);
            localStorage.setItem(WQ_LOCAL_KEY, JSON.stringify(compressedArray));
        } else {
            localStorage.setItem(WQ_LOCAL_KEY, JSON.stringify(arr));
        }
    } catch (e) {
        console.error('[wrong_sync] failed to save wrong_questions', e);
        try {
            localStorage.setItem(WQ_LOCAL_KEY, JSON.stringify(arr));
        } catch (e2) {
            console.error('[wrong_sync] catastrophic failure', e2);
        }
    }
}

// ---------- Data migration: add timestamp + deleted flag ----------
function migrateWrongList(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(item => {
        if (item && typeof item === 'object' && 'timestamp' in item && 'deleted' in item) {
            return item;
        }
        return {
            filePath: item.filePath,
            questionIndex: item.questionIndex,
            timestamp: Date.now(),
            deleted: false
        };
    });
}

// ---------- Merge: keep entry with newest timestamp, honor deleted flag ----------
function mergeWrongLists(localArr, cloudArr) {
    const map = new Map();
    function addEntry(entry) {
        const key = `${entry.filePath}::${entry.questionIndex}`;
        const existing = map.get(key);
        if (!existing || entry.timestamp > existing.timestamp) {
            map.set(key, { ...entry });
        }
    }
    localArr.forEach(addEntry);
    cloudArr.forEach(addEntry);
    const result = [];
    for (const entry of map.values()) {
        if (!entry.deleted) result.push(entry);
    }
    return result;
}

// ---------- Cloud sync with optimistic locking ----------
async function uploadWrongWithLock(url, data, currentETag) {
    const headers = { 'Content-Type': 'application/json' };
    if (currentETag) headers['If-Match'] = currentETag;
    let resp;
    try {
        resp = await fetch(url, { method: 'PUT', body: JSON.stringify(data), headers });
    } catch (e) {
        console.warn('[wrong_sync] upload network error', e);
        return null;
    }
    if (resp.status === 412) {
        try {
            const refetch = await fetch(url, { cache: 'no-store' });
            if (!refetch.ok) return null;
            const remote = await refetch.json();
            const newETag = refetch.headers.get('ETag');
            const local = getWrongLocal();
            const merged = mergeWrongLists(local, remote);
            setWrongLocal(merged);
            return await uploadWrongWithLock(url, merged, newETag);
        } catch (e) {
            console.warn('[wrong_sync] conflict resolution failed', e);
            return null;
        }
    }
    return resp;
}

// ---------- Main sync function (UPDATED path to match sync.js pattern) ----------
async function syncWrongQuestions() {
    const userId = localStorage.getItem('quiz_user_id');
    if (!userId || (userId !== '1' && userId !== '2')) return;

    const localArr = getWrongLocal();
    // *** CHANGE: now uses subfolder + state.json like sync.js ***
    const cloudKey = `${WQ_FOLDER}/user${userId}/state.json`;
    const cloudUrl = `${WQ_BUCKET_API}/${cloudKey}`;

    let cloudArr = null, etag = null;
    try {
        const resp = await fetch(cloudUrl, { cache: 'no-store' });
        if (resp.ok) {
            cloudArr = await resp.json();
            etag = resp.headers.get('ETag');
            if (Array.isArray(cloudArr)) {
                cloudArr = migrateWrongList(cloudArr);
            } else {
                cloudArr = [];
            }
        }
    } catch (e) {
        console.warn('[wrong_sync] fetch failed – keeping local', e);
        return;
    }

    try {
        const merged = mergeWrongLists(localArr, cloudArr || []);
        setWrongLocal(merged);
        if (etag !== null || cloudArr !== null) {
            await uploadWrongWithLock(cloudUrl, merged, etag);
        }
    } catch (e) {
        console.warn('[wrong_sync] merge/upload failed', e);
    }
}

// ---------- Expose for HTML pages ----------
if (typeof window !== 'undefined') {
    window.getWrongLocal = getWrongLocal;
    window.setWrongLocal = setWrongLocal;
    window.syncWrongQuestions = syncWrongQuestions;
}