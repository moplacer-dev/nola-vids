/**
 * Wraps fetch with AbortController timeout
 * @param {string} url - URL to fetch
 * @param {object} options - fetch options
 * @param {number} timeoutMs - timeout in milliseconds (default: 30000 for API calls)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Default timeouts
const TIMEOUTS = {
  API: 30000,      // 30 seconds for API calls
  DOWNLOAD: 300000 // 5 minutes for video downloads
};

module.exports = { fetchWithTimeout, TIMEOUTS };
