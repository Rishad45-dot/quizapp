
// sync.js – cross‑device progress sync via Tencent COS (two users)
const BUCKET_API = 'https://quiz-app-bucket-1428146716.cos.ap-hongkong.myqcloud.com';
const SYNC_FOLDER = 'sync';

// localStorage key prefixes (must match quiz_player & index)
const KEY_PREFIX_FULL      = 'full_progress_';
const KEY_PREFIX_STATS     = 'quiz_stats_';
const KEY_PREFIX_COMPLETED = 'quiz_completed_';
const KEY_PREFIX_SAVED     = 'saved_questions_';
const KEY_DAILY            = 'quiz_daily_history';
const KEY_LAST_CHAPTER     = 'last_practiced_chapter';
const KEY_USER_ID          = 'quiz_user_id';

// ----- localStorage helpers -----
function getMangledPaths() {
  const set = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(KEY_PREFIX_FULL)) set.add(k.substring(KEY_PREFIX_FULL.length));
  }
  return [...set];
}

// ----- Build / apply local state -----
function buildLocalState() {
  const dailyHistory = JSON.parse(localStorage.getItem(KEY_DAILY) || '{}');
  const lastPracticed = localStorage.getItem(KEY_LAST_CHAPTER) || '';
  const chapters = {};
  const paths = getMangledPaths();
  paths.forEach(mp => {
    const fullRaw       = localStorage.getItem(`${KEY_PREFIX_FULL}${mp}`);
    const statsRaw      = localStorage.getItem(`${KEY_PREFIX_STATS}${mp}`);
    const completed     = localStorage.getItem(`${KEY_PREFIX_COMPLETED}${mp}`) === 'true';
    const savedRaw      = localStorage.getItem(`${KEY_PREFIX_SAVED}${mp}`);
    chapters[mp] = {
      fullProgress: fullRaw ? JSON.parse(fullRaw) : { fullUserAnswers: [], fullAnswerStatus: [] },
      completed,
      stats: statsRaw ? JSON.parse(statsRaw) : null,
      savedQuestions: savedRaw ? JSON.parse(savedRaw) : [],
      lastModified: Date.now()
    };
  });
  return { dailyHistory, lastPracticedChapter: lastPracticed, chapters, lastModified: Date.now() };
}

function applyState(state) {
  localStorage.setItem(KEY_DAILY, JSON.stringify(state.dailyHistory));
  if (state.lastPracticedChapter) localStorage.setItem(KEY_LAST_CHAPTER, state.lastPracticedChapter);
  Object.entries(state.chapters).forEach(([mp, chap]) => {
    if (chap.fullProgress) localStorage.setItem(`${KEY_PREFIX_FULL}${mp}`, JSON.stringify(chap.fullProgress));
    if (chap.completed) localStorage.setItem(`${KEY_PREFIX_COMPLETED}${mp}`, 'true');
    else localStorage.removeItem(`${KEY_PREFIX_COMPLETED}${mp}`);
    if (chap.stats) localStorage.setItem(`${KEY_PREFIX_STATS}${mp}`, JSON.stringify(chap.stats));
    else localStorage.removeItem(`${KEY_PREFIX_STATS}${mp}`);
    localStorage.setItem(`${KEY_PREFIX_SAVED}${mp}`, JSON.stringify(chap.savedQuestions || []));
  });
}

// ----- Merge two states (local vs cloud) -----
function mergeStates(localState, cloudState) {
  // merge daily histories
  const mergedDaily = { ...localState.dailyHistory };
  Object.entries(cloudState.dailyHistory).forEach(([date, data]) => {
    if (!mergedDaily[date]) mergedDaily[date] = { count: 0, practicedIds: [] };
    const ids = new Set([...(mergedDaily[date].practicedIds || []), ...(data.practicedIds || [])]);
    mergedDaily[date].practicedIds = [...ids];
    mergedDaily[date].count = ids.size;
  });

  const mergedChapters = { ...localState.chapters };
  Object.entries(cloudState.chapters).forEach(([mp, cloudCh]) => {
    const localCh = localState.chapters[mp];
    if (!localCh) { mergedChapters[mp] = cloudCh; return; }

    const localFP = localCh.fullProgress || { fullUserAnswers: [], fullAnswerStatus: [] };
    const cloudFP = cloudCh.fullProgress || { fullUserAnswers: [], fullAnswerStatus: [] };
    const maxLen = Math.max(localFP.fullUserAnswers.length, cloudFP.fullUserAnswers.length);
    const mergedAnswers = [], mergedStatus = [];
    for (let i = 0; i < maxLen; i++) {
      const localAns = localFP.fullUserAnswers[i];
      const cloudAns = cloudFP.fullUserAnswers[i];
      const localStat = localFP.fullAnswerStatus ? localFP.fullAnswerStatus[i] : false;
      const cloudStat = cloudFP.fullAnswerStatus ? cloudFP.fullAnswerStatus[i] : false;

      const localNonEmpty = localAns !== null && localAns !== undefined && (Array.isArray(localAns) ? localAns.length > 0 : true);
      const cloudNonEmpty = cloudAns !== null && cloudAns !== undefined && (Array.isArray(cloudAns) ? cloudAns.length > 0 : true);

      if (localNonEmpty && !cloudNonEmpty) {
        mergedAnswers.push(localAns); mergedStatus.push(localStat);
      } else if (!localNonEmpty && cloudNonEmpty) {
        mergedAnswers.push(cloudAns); mergedStatus.push(cloudStat);
      } else if (localNonEmpty && cloudNonEmpty) {
        const localTs = localCh.lastModified || 0;
        const cloudTs = cloudCh.lastModified || 0;
        if (cloudTs >= localTs) { mergedAnswers.push(cloudAns); mergedStatus.push(cloudStat); }
        else { mergedAnswers.push(localAns); mergedStatus.push(localStat); }
      } else {
        mergedAnswers.push(localAns !== undefined ? localAns : cloudAns);
        mergedStatus.push(localStat || cloudStat);
      }
    }
    mergedChapters[mp] = {
      fullProgress: { fullUserAnswers: mergedAnswers, fullAnswerStatus: mergedStatus },
      completed: localCh.completed || cloudCh.completed,
      stats: cloudCh.stats || localCh.stats,
      savedQuestions: [...new Set([...(localCh.savedQuestions||[]), ...(cloudCh.savedQuestions||[])])],
      lastModified: Math.max(localCh.lastModified||0, cloudCh.lastModified||0)
    };
  });

  return {
    dailyHistory: mergedDaily,
    lastPracticedChapter: cloudState.lastPracticedChapter || localState.lastPracticedChapter,
    chapters: mergedChapters,
    lastModified: Date.now()
  };
}

// ----- Upload with optimistic locking (ETag) -----
async function uploadWithLock(url, data, currentETag) {
  const headers = { 'Content-Type': 'application/json' };
  if (currentETag) headers['If-Match'] = currentETag;
  const resp = await fetch(url, { method: 'PUT', body: JSON.stringify(data), headers });
  if (resp.status === 412) {
    // conflict – re‑fetch, merge, retry once
    const refetch = await fetch(url, { cache: 'no-store' });
    if (refetch.ok) {
      const remote = await refetch.json();
      const newETag = refetch.headers.get('ETag');
      const local = buildLocalState();
      const merged = mergeStates(local, remote);
      applyState(merged);
      return await uploadWithLock(url, merged, newETag);
    }
  }
  return resp;
}

// ----- Main sync routine -----
async function syncNow() {
  const userId = localStorage.getItem(KEY_USER_ID);
  if (!userId || (userId !== '1' && userId !== '2')) return;

  const localState = buildLocalState();
  const cloudKey = `${SYNC_FOLDER}/user${userId}/state.json`;
  const cloudUrl = `${BUCKET_API}/${cloudKey}`;

  let cloudState = null, etag = null;
  try {
    const resp = await fetch(cloudUrl, { cache: 'no-store' });
    if (resp.ok) {
      cloudState = await resp.json();
      etag = resp.headers.get('ETag');
    }
  } catch (e) { return; } // offline – keep local

  if (cloudState) {
    const merged = mergeStates(localState, cloudState);
    applyState(merged);
    await uploadWithLock(cloudUrl, merged, etag);
  } else {
    // first upload
    await uploadWithLock(cloudUrl, localState, null);
  }

  // refresh UI if functions exist
  if (typeof updateDailyDisplay === 'function') updateDailyDisplay();
  if (typeof updateStatsDisplay === 'function') updateStatsDisplay();
  if (typeof renderQuiz === 'function') renderQuiz();
  if (typeof expandLastPracticedChapter === 'function') expandLastPracticedChapter();
}
