/**
 * Upload-Post API client for submitting posts from uploads/{projectId}/posts/...
 * API docs: https://docs.upload-post.com/llm.txt
 *
 * Dual-mode routing:
 *   1. Local key mode: user has their own Upload Post API key in Settings → posts directly to api.upload-post.com
 *   2. Backend proxy mode: user is logged in via Whop (no local key) → posts through extensiblecontent.com
 *      which injects the master API key server-side. The key never reaches the client.
 *
 * Priority: local key (if set) > backend proxy (if logged in) > error
 */
(function () {
  'use strict';

  const BASE = 'https://api.upload-post.com/api';
  const STORAGE_KEY = 'uploadPostApiKey';

  // ---------------------------------------------------------------------------
  // Auth mode resolution
  // ---------------------------------------------------------------------------

  /**
   * Determine the auth mode and optional local API key.
   * @returns {Promise<{ key: string|null, mode: 'local'|'backend'|null }>}
   */
  async function getAuthMode() {
    // 1. Check local Settings key first (user's own key = direct mode)
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const o = await chrome.storage.local.get(STORAGE_KEY);
        const k = o[STORAGE_KEY];
        if (typeof k === 'string' && k.trim()) return { key: k.trim(), mode: 'local' };
      } catch (_) {}
    }
    // 2. Check if logged in via Whop (backend proxy mode — no key)
    if (typeof window !== 'undefined' && window.ExtensionApi && typeof window.ExtensionApi.isLoggedIn === 'function') {
      try {
        const loggedIn = await window.ExtensionApi.isLoggedIn();
        if (loggedIn) return { key: null, mode: 'backend' };
      } catch (_) {}
    }
    // 3. Neither
    return { key: null, mode: null };
  }

  /**
   * Legacy getApiKey — returns just the local API key string, or null.
   * For local-key mode only. Does NOT check backend.
   * @returns {Promise<string|null>}
   */
  async function getApiKey() {
    const auth = await getAuthMode();
    return auth.key;
  }

  async function getLocalApiKey() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
    const o = await chrome.storage.local.get(STORAGE_KEY);
    const k = o[STORAGE_KEY];
    return typeof k === 'string' && k.trim() ? k.trim() : null;
  }

  async function setApiKey(key) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: (key && key.trim()) || '' });
  }

  // ---------------------------------------------------------------------------
  // Backend proxy helpers (Supabase storage + server-side posting)
  // ---------------------------------------------------------------------------

  /**
   * Upload a File/Blob to Supabase storage via the backend presigned URL flow.
   * @param {File|Blob} fileOrBlob
   * @param {string} [projectId] - optional project_id for storage organization (defaults to 'default')
   * @returns {Promise<{ ok: boolean, file_url?: string, file_id?: string, error?: string }>}
   */
  async function _uploadMediaToSupabase(fileOrBlob, projectId) {
    if (!window.ExtensionApi || typeof window.ExtensionApi.getPostStorageUploadUrl !== 'function') {
      return { ok: false, error: 'Backend storage API not available' };
    }
    var filename = fileOrBlob.name || 'upload';
    var ct = fileOrBlob.type || 'application/octet-stream';
    var size = fileOrBlob.size || 0;
    var pid = (projectId && String(projectId).trim()) ? String(projectId).trim() : 'default';
    // 1. Get presigned URL from backend
    var presigned = await window.ExtensionApi.getPostStorageUploadUrl({
      filename: filename,
      content_type: ct,
      size_bytes: size,
      project_id: pid,
    });
    if (!presigned.ok) return { ok: false, error: presigned.error || 'Failed to get upload URL' };
    // 2. PUT file to Supabase
    try {
      var res = await fetch(presigned.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': ct },
        body: fileOrBlob,
      });
      if (!res.ok) return { ok: false, error: 'Upload failed: ' + (res.statusText || 'HTTP ' + res.status) };
      return { ok: true, file_url: presigned.file_url, file_id: presigned.file_id };
    } catch (e) {
      return { ok: false, error: 'Upload failed: ' + (e.message || 'Network error') };
    }
  }

  /**
   * Build the common extra opts into a flat object for backend payload.
   */
  function _flattenOpts(opts) {
    var result = {};
    if (!opts || typeof opts !== 'object') return result;
    Object.keys(opts).forEach(function (k) {
      var v = opts[k];
      if (v === undefined || v === null) return;
      if (typeof v === 'object' && !Array.isArray(v)) return; // skip nested objects
      result[k] = v;
    });
    return result;
  }

  /**
   * Submit a post through the backend proxy.
   * Uploads media to Supabase first, then sends metadata to the backend.
   * @param {'video'|'photo'|'text'} postType
   * @param {object} params — same shape as submitVideo/submitPhotos/submitText
   * @returns {Promise<{ ok: boolean, json?: object, error?: string }>}
   */
  async function _submitViaBackend(postType, params) {
    if (!window.ExtensionApi || typeof window.ExtensionApi.proxyUploadPost !== 'function') {
      return { ok: false, error: 'Backend proxy API not available. Log in or set a local API key.' };
    }

    var videoUrl = null;
    var photoUrls = [];
    var opts = _flattenOpts(params.options);
    var projectId = (params.project_id || params.projectId || opts.project_id || '').toString().trim() || 'default';

    // Upload media to Supabase if Files/Blobs provided
    if (postType === 'video' && params.video) {
      if (params.video instanceof File || params.video instanceof Blob) {
        var upload = await _uploadMediaToSupabase(params.video, projectId);
        if (!upload.ok) return upload;
        videoUrl = upload.file_url;
      } else if (typeof params.video === 'string') {
        videoUrl = params.video;
      }
    }

    if (postType === 'photo' && params.photos) {
      for (var i = 0; i < params.photos.length; i++) {
        var photo = params.photos[i];
        if (photo instanceof File || photo instanceof Blob) {
          var pUpload = await _uploadMediaToSupabase(photo, projectId);
          if (!pUpload.ok) return pUpload;
          photoUrls.push(pUpload.file_url);
        } else if (typeof photo === 'string') {
          photoUrls.push(photo);
        }
      }
    }

    var payload = {
      profile_username: params.user,
      postType: postType,
      platform: params.platform || [],
      title: params.title || '',
      description: params.description || '',
      async_upload: true,
    };
    if (videoUrl) payload.video_url = videoUrl;
    if (photoUrls.length) payload.photo_urls = photoUrls;

    // Merge options into payload
    Object.keys(opts).forEach(function (k) { payload[k] = opts[k]; });

    return window.ExtensionApi.proxyUploadPost(payload);
  }

  // ---------------------------------------------------------------------------
  // Direct-mode helpers (local API key → api.upload-post.com)
  // ---------------------------------------------------------------------------

  /**
   * @param {FormData} form
   * @param {string} apiKey
   * @param {string} endpoint
   * @returns {Promise<{ ok: boolean, json?: object, error?: string }>}
   */
  async function _directRequest(form, apiKey, endpoint) {
    var url = BASE + endpoint;
    var headers = { Authorization: 'Apikey ' + apiKey };
    try {
      var body = form.get ? form : new URLSearchParams(form);
      var res = await fetch(url, {
        method: 'POST',
        headers: body instanceof FormData ? headers : { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body,
      });
      var json = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        var msg = json.message || json.error || res.statusText || 'Request failed';
        var detail = res.status === 429 && json.violations ? ' ' + JSON.stringify(json.violations) : '';
        return { ok: false, error: msg + detail, json: json };
      }
      return { ok: true, json: json };
    } catch (e) {
      return { ok: false, error: e.message || 'Network error' };
    }
  }

  function _appendOpts(form, opts) {
    if (!opts) return;
    if (opts.scheduled_date) form.append('scheduled_date', opts.scheduled_date);
    if (opts.async_upload !== undefined) form.append('async_upload', opts.async_upload ? 'true' : 'false');
    if (opts.timezone) form.append('timezone', opts.timezone);
    Object.keys(opts).forEach(function (k) {
      if (['scheduled_date', 'async_upload', 'timezone'].includes(k)) return;
      var v = opts[k];
      if (Array.isArray(v)) {
        v.forEach(function (item) { form.append(k + '[]', String(item)); });
      } else if (v !== undefined && v !== null && typeof v !== 'object') {
        form.append(k, String(v));
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Public API — each method routes based on getAuthMode()
  // ---------------------------------------------------------------------------

  /**
   * Submit video post. Uses multipart/form-data with file or URL.
   * @param {{ user: string, platform: string[], title: string, description?: string, video: File|string, options?: object }} params
   */
  async function submitVideo(params) {
    var auth = await getAuthMode();
    if (auth.mode === 'backend') return _submitViaBackend('video', params);
    if (auth.mode === 'local') {
      var form = new FormData();
      form.append('user', params.user);
      (params.platform || []).forEach(function (p) { form.append('platform[]', p); });
      form.append('title', params.title || '');
      if (params.description != null) form.append('description', params.description);
      if (params.video instanceof File) {
        form.append('video', params.video);
      } else if (typeof params.video === 'string' && params.video) {
        form.append('video', params.video);
      } else {
        return { ok: false, error: 'Missing video file or URL' };
      }
      _appendOpts(form, params.options);
      return _directRequest(form, auth.key, '/upload');
    }
    return { ok: false, error: 'Upload-Post API key not set and not logged in.' };
  }

  /**
   * Submit photo post. Uses multipart with files or URLs.
   * @param {{ user: string, platform: string[], title: string, description?: string, photos: File[]|string[], options?: object }} params
   */
  async function submitPhotos(params) {
    var auth = await getAuthMode();
    if (auth.mode === 'backend') return _submitViaBackend('photo', params);
    if (auth.mode === 'local') {
      var form = new FormData();
      form.append('user', params.user);
      (params.platform || []).forEach(function (p) { form.append('platform[]', p); });
      form.append('title', params.title || '');
      if (params.description != null) form.append('description', params.description);
      var photos = params.photos || [];
      if (photos.length === 0) return { ok: false, error: 'Missing photos' };
      photos.forEach(function (item) {
        if (item instanceof File) form.append('photos[]', item);
        else if (typeof item === 'string') form.append('photos[]', item);
      });
      _appendOpts(form, params.options);
      return _directRequest(form, auth.key, '/upload_photos');
    }
    return { ok: false, error: 'Upload-Post API key not set and not logged in.' };
  }

  /**
   * Submit text-only post.
   * @param {{ user: string, platform: string[], title: string, description?: string, options?: object }} params
   */
  async function submitText(params) {
    var auth = await getAuthMode();
    if (auth.mode === 'backend') return _submitViaBackend('text', params);
    if (auth.mode === 'local') {
      var form = new FormData();
      form.append('user', params.user);
      (params.platform || []).forEach(function (p) { form.append('platform[]', p); });
      form.append('title', params.title || '');
      if (params.description != null) form.append('description', params.description);
      _appendOpts(form, params.options);
      return _directRequest(form, auth.key, '/upload_text');
    }
    return { ok: false, error: 'Upload-Post API key not set and not logged in.' };
  }

  /**
   * Check upload status (async or scheduled).
   * @param {{ request_id?: string, job_id?: string }}
   */
  async function checkStatus(params) {
    if (!params.request_id && !params.job_id) return { ok: false, error: 'request_id or job_id required' };
    var auth = await getAuthMode();
    if (auth.mode === 'backend') {
      if (!window.ExtensionApi || typeof window.ExtensionApi.proxyUploadPostStatus !== 'function') {
        return { ok: false, error: 'Backend proxy not available' };
      }
      return window.ExtensionApi.proxyUploadPostStatus(params);
    }
    if (auth.mode === 'local') {
      var q = new URLSearchParams();
      if (params.request_id) q.set('request_id', params.request_id);
      if (params.job_id) q.set('job_id', params.job_id);
      try {
        var res = await fetch(BASE + '/uploadposts/status?' + q.toString(), {
          headers: { Authorization: 'Apikey ' + auth.key },
        });
        var json = await res.json().catch(function () { return {}; });
        if (!res.ok) return { ok: false, error: json.message || json.error || res.statusText, json: json };
        return { ok: true, json: json };
      } catch (e) {
        return { ok: false, error: e.message || 'Network error' };
      }
    }
    return { ok: false, error: 'API key not set and not logged in' };
  }

  /**
   * List scheduled posts.
   * @returns {{ ok: boolean, json?: Array, error?: string }}
   */
  async function listScheduled() {
    var auth = await getAuthMode();
    if (auth.mode === 'backend') {
      if (!window.ExtensionApi || typeof window.ExtensionApi.proxyUploadPostScheduled !== 'function') {
        return { ok: false, error: 'Backend proxy not available' };
      }
      var backendRes = await window.ExtensionApi.proxyUploadPostScheduled();
      if (!backendRes.ok) return backendRes;
      var list = Array.isArray(backendRes.json) ? backendRes.json : (backendRes.result || backendRes.payload || backendRes.list || []);
      return { ok: true, json: list };
    }
    if (auth.mode === 'local') {
      try {
        var res = await fetch(BASE + '/uploadposts/schedule', {
          headers: { Authorization: 'Apikey ' + auth.key },
        });
        var json = await res.json().catch(function () { return {}; });
        if (!res.ok) return { ok: false, error: json.message || json.error || res.statusText, json: json };
        var items = Array.isArray(json) ? json : (json.result || json.payload || json.list || []);
        return { ok: true, json: items };
      } catch (e) {
        return { ok: false, error: e.message || 'Network error' };
      }
    }
    return { ok: false, error: 'API key not set and not logged in' };
  }

  /**
   * Cancel a scheduled post.
   * @param {string} jobId
   */
  async function cancelScheduled(jobId) {
    if (!jobId || !String(jobId).trim()) return { ok: false, error: 'job_id required' };
    var auth = await getAuthMode();
    if (auth.mode === 'backend') {
      if (!window.ExtensionApi || typeof window.ExtensionApi.proxyUploadPostCancelScheduled !== 'function') {
        return { ok: false, error: 'Backend proxy not available' };
      }
      return window.ExtensionApi.proxyUploadPostCancelScheduled(String(jobId).trim());
    }
    if (auth.mode === 'local') {
      try {
        var res = await fetch(BASE + '/uploadposts/schedule/' + encodeURIComponent(String(jobId).trim()), {
          method: 'DELETE',
          headers: { Authorization: 'Apikey ' + auth.key },
        });
        var json = await res.json().catch(function () { return {}; });
        if (!res.ok) return { ok: false, error: json.error || json.message || res.statusText, json: json };
        return { ok: true, json: json };
      } catch (e) {
        return { ok: false, error: e.message || 'Network error' };
      }
    }
    return { ok: false, error: 'API key not set and not logged in' };
  }

  /**
   * Retrieve paginated upload history.
   * @param {{ page?: number, limit?: number }} params
   */
  async function getHistory(params) {
    params = params || {};
    var auth = await getAuthMode();
    if (auth.mode === 'backend') {
      if (!window.ExtensionApi || typeof window.ExtensionApi.proxyUploadPostHistory !== 'function') {
        return { ok: false, error: 'Backend proxy not available' };
      }
      return window.ExtensionApi.proxyUploadPostHistory(params);
    }
    if (auth.mode === 'local') {
      var q = new URLSearchParams();
      if (params.page) q.set('page', String(params.page));
      if (params.limit) q.set('limit', String(params.limit));
      try {
        var res = await fetch(BASE + '/uploadposts/history?' + q.toString(), {
          headers: { Authorization: 'Apikey ' + auth.key },
        });
        var json = await res.json().catch(function () { return {}; });
        if (!res.ok) return { ok: false, error: json.error || json.message || res.statusText, json: json };
        return { ok: true, json: json };
      } catch (e) {
        return { ok: false, error: e.message || 'Network error' };
      }
    }
    return { ok: false, error: 'API key not set and not logged in' };
  }

  /**
   * Get all user profiles.
   * @returns {{ ok: boolean, profiles?: Array, error?: string }}
   */
  async function getUserProfiles() {
    var auth = await getAuthMode();
    if (auth.mode === 'backend') {
      if (!window.ExtensionApi || typeof window.ExtensionApi.proxyUploadPostProfiles !== 'function') {
        return { ok: false, error: 'Backend proxy not available' };
      }
      return window.ExtensionApi.proxyUploadPostProfiles();
    }
    if (auth.mode === 'local') {
      return getUserProfilesWithKey(auth.key);
    }
    return { ok: false, error: 'API key not set and not logged in' };
  }

  /**
   * Get user profiles using a specific API key (e.g. the one from Settings).
   * Always direct mode — used for local key operations.
   * @param {string} apiKey
   * @returns {{ ok: boolean, profiles?: Array, error?: string }}
   */
  async function getUserProfilesWithKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) return { ok: false, error: 'API key not set' };
    try {
      var res = await fetch(BASE + '/uploadposts/users', {
        headers: { Authorization: 'Apikey ' + apiKey.trim() },
      });
      var json = await res.json().catch(function () { return {}; });
      if (!res.ok) return { ok: false, error: json.error || json.message || res.statusText, json: json };
      return { ok: true, profiles: json.profiles || [], plan: json.plan, limit: json.limit };
    } catch (e) {
      return { ok: false, error: e.message || 'Network error' };
    }
  }

  /**
   * Create a user profile under the given API key (POST /uploadposts/users).
   * Always direct mode.
   * @param {string} apiKey
   * @param {string} username
   * @returns {Promise<{ ok: boolean, profile?: object, error?: string, status?: number, json?: object }>}
   */
  async function createUserProfileWithKey(apiKey, username) {
    var key = typeof apiKey === 'string' ? apiKey.trim() : '';
    var u = typeof username === 'string' ? username.trim() : '';
    if (!key) return { ok: false, error: 'API key not set' };
    if (!u) return { ok: false, error: 'username required' };
    try {
      var res = await fetch(BASE + '/uploadposts/users', {
        method: 'POST',
        headers: {
          Authorization: 'Apikey ' + key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: u }),
      });
      var json = await res.json().catch(function () { return {}; });
      if (res.status === 201 || res.ok) return { ok: true, profile: json.profile, json: json };
      if (res.status === 409) return { ok: false, error: json.error || json.message || 'Profile already exists', status: 409, json: json };
      return { ok: false, error: json.error || json.message || res.statusText, status: res.status, json: json };
    } catch (e) {
      return { ok: false, error: e.message || 'Network error' };
    }
  }

  /**
   * Generate a JWT access URL for a user profile.
   * @param {{ username: string, redirect_url?: string, platforms?: string[] }} params
   */
  async function generateJwt(params) {
    if (!params || !params.username) return { ok: false, error: 'username required' };
    var auth = await getAuthMode();
    if (auth.mode === 'backend') {
      if (!window.ExtensionApi || typeof window.ExtensionApi.proxyUploadPostGenerateJwt !== 'function') {
        return { ok: false, error: 'Backend proxy not available' };
      }
      return window.ExtensionApi.proxyUploadPostGenerateJwt(params);
    }
    if (auth.mode === 'local') {
      try {
        var res = await fetch(BASE + '/uploadposts/users/generate-jwt', {
          method: 'POST',
          headers: {
            Authorization: 'Apikey ' + auth.key,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
        });
        var json = await res.json().catch(function () { return {}; });
        if (!res.ok) return { ok: false, error: json.error || json.message || res.statusText, json: json };
        return { ok: true, access_url: json.access_url, duration: json.duration, json: json };
      } catch (e) {
        return { ok: false, error: e.message || 'Network error' };
      }
    }
    return { ok: false, error: 'API key not set and not logged in' };
  }

  if (typeof window !== 'undefined') {
    window.UploadPost = {
      getAuthMode,
      getApiKey,
      getLocalApiKey,
      setApiKey,
      submitVideo,
      submitPhotos,
      submitText,
      checkStatus,
      listScheduled,
      cancelScheduled,
      getHistory,
      getUserProfiles,
      getUserProfilesWithKey,
      createUserProfileWithKey,
      generateJwt,
    };
  }
})();
