// wrong_sync.js – cross‑device wrong question sync (mirrors sync.js pattern)
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

// ---------- localStorage read/write with compression ----------
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

// ---------- Data migration: add timestamp + deleted ----------
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

// ---------- Merge (same as before) ----------
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

// ---------- Upload with lock (exactly as sync.js) ----------
async function uploadWithLock(url, data, currentETag) {
    const headers = { 'Content-Type': 'application/json' };
    if (currentETag) headers['If-Match'] = currentETag;
    const resp = await fetch(url, { method: 'PUT', body: JSON.stringify(data), headers });
    if (resp.status === 412) {
        const refetch = await fetch(url, { cache: 'no-store' });
        if (refetch.ok) {
            const remote = await refetch.json();
            const newETag = refetch.headers.get('ETag');
            const local = getWrongLocal();
            const merged = mergeWrongLists(local, remote);
            setWrongLocal(merged);
            return await uploadWithLock(url, merged, newETag);
        }
    }
    return resp;
}

// ---------- Main sync function (identical pattern to sync.js) ----------
async function syncWrongQuestions() {
    const userId = localStorage.getItem('quiz_user_id');
    if (!userId || (userId !== '1' && userId !== '2')) return;

    const localArr = getWrongLocal();
    const cloudKey = `${WQ_FOLDER}/user${userId}/state.json`;
    const cloudUrl = `${WQ_BUCKET_API}/${cloudKey}`;

    let cloudArr = null, etag = null;
    try {
        const resp = await fetch(cloudUrl, { cache: 'no-store' });
        if (resp.ok) {
            cloudArr = await resp.json();
            etag = resp.headers.get('ETag');
            if (Array.isArray(cloudArr)) cloudArr = migrateWrongList(cloudArr);
        }
    } catch (e) {
        // network error – skip sync
        return;
    }

    if (cloudArr !== null) {
        const merged = mergeWrongLists(localArr, cloudArr);
        setWrongLocal(merged);
        await uploadWithLock(cloudUrl, merged, etag);
    } else {
        // No cloud file yet – upload local with null ETag (creates file)
        await uploadWithLock(cloudUrl, localArr, null);
    }
}

// ---------- Expose for HTML pages ----------
if (typeof window !== 'undefined') {
    window.getWrongLocal = getWrongLocal;
    window.setWrongLocal = setWrongLocal;
    window.syncWrongQuestions = syncWrongQuestions;
}