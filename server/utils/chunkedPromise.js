/**
 * Execute async operations in chunks to prevent memory spikes from
 * too many concurrent operations (especially file downloads/uploads).
 *
 * @param {Array} items - Array of items to process
 * @param {Function} asyncFn - Async function to call for each item
 * @param {number} chunkSize - Max concurrent operations (default: 5)
 * @returns {Promise<Array>} - Flattened results from all operations
 */
async function chunkedPromiseAll(items, asyncFn, chunkSize = 5) {
  if (!items || items.length === 0) return [];

  const results = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(asyncFn));
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Execute async operations in chunks with index access.
 * Useful when you need the index in your async function.
 *
 * @param {Array} items - Array of items to process
 * @param {Function} asyncFn - Async function receiving (item, index)
 * @param {number} chunkSize - Max concurrent operations (default: 5)
 * @returns {Promise<Array>} - Flattened results from all operations
 */
async function chunkedPromiseAllWithIndex(items, asyncFn, chunkSize = 5) {
  if (!items || items.length === 0) return [];

  const results = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map((item, chunkIdx) => asyncFn(item, i + chunkIdx))
    );
    results.push(...chunkResults);
  }

  return results;
}

module.exports = {
  chunkedPromiseAll,
  chunkedPromiseAllWithIndex
};
