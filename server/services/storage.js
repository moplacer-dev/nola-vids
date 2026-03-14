const { supabase } = require('../db/supabase');
const path = require('path');

// Storage bucket names
const BUCKETS = {
  VIDEOS: 'videos',
  IMAGES: 'images',
  ANCHORS: 'anchors',
  MG_VIDEOS: 'mg-videos',
  AUDIO: 'audio',
  UPLOADS: 'uploads',
  DEFAULTS: 'defaults'
};

/**
 * Upload a file to Supabase Storage
 * @param {string} bucket - The bucket name
 * @param {string} filename - The filename/path within the bucket
 * @param {Buffer} buffer - The file data as a buffer
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<{path: string, publicUrl: string}>}
 */
async function uploadFile(bucket, filename, buffer, contentType) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filename, buffer, {
      contentType,
      upsert: true
    });

  if (error) {
    throw new Error(`Failed to upload file to ${bucket}/${filename}: ${error.message}`);
  }

  const publicUrl = getPublicUrl(bucket, filename);

  return {
    path: data.path,
    publicUrl
  };
}

/**
 * Upload a file from a local path to Supabase Storage
 * @param {string} bucket - The bucket name
 * @param {string} filename - The filename/path within the bucket
 * @param {string} localPath - Local file path to upload
 * @param {string} contentType - MIME type of the file
 * @returns {Promise<{path: string, publicUrl: string}>}
 */
async function uploadFileFromPath(bucket, filename, localPath, contentType) {
  const fs = require('fs');
  const buffer = fs.readFileSync(localPath);
  return uploadFile(bucket, filename, buffer, contentType);
}

/**
 * Get the public URL for a file in storage
 * @param {string} bucket - The bucket name
 * @param {string} filename - The filename/path within the bucket
 * @returns {string} - The public URL
 */
function getPublicUrl(bucket, filename) {
  const { data } = supabase.storage
    .from(bucket)
    .getPublicUrl(filename);

  return data.publicUrl;
}

/**
 * Delete a file from Supabase Storage
 * @param {string} bucket - The bucket name
 * @param {string} filename - The filename/path within the bucket
 * @returns {Promise<boolean>} - True if deleted successfully
 */
async function deleteFile(bucket, filename) {
  const { error } = await supabase.storage
    .from(bucket)
    .remove([filename]);

  if (error) {
    console.error(`Failed to delete file ${bucket}/${filename}:`, error.message);
    return false;
  }

  return true;
}

/**
 * Download a file from Supabase Storage
 * @param {string} bucket - The bucket name
 * @param {string} filename - The filename/path within the bucket
 * @returns {Promise<Buffer>} - The file data as a buffer
 */
async function downloadFile(bucket, filename) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(filename);

  if (error) {
    throw new Error(`Failed to download file from ${bucket}/${filename}: ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Copy a file within or between buckets
 * @param {string} sourceBucket - Source bucket name
 * @param {string} sourceFile - Source filename
 * @param {string} destBucket - Destination bucket name
 * @param {string} destFile - Destination filename
 * @returns {Promise<{path: string, publicUrl: string}>}
 */
async function copyFile(sourceBucket, sourceFile, destBucket, destFile) {
  // Download from source
  const buffer = await downloadFile(sourceBucket, sourceFile);

  // Determine content type from extension
  const ext = path.extname(destFile).toLowerCase();
  const contentTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
  };
  const contentType = contentTypes[ext] || 'application/octet-stream';

  // Upload to destination
  return uploadFile(destBucket, destFile, buffer, contentType);
}

/**
 * Check if a file exists in storage
 * @param {string} bucket - The bucket name
 * @param {string} filename - The filename/path within the bucket
 * @returns {Promise<boolean>}
 */
async function fileExists(bucket, filename) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(path.dirname(filename) || '', {
      limit: 1,
      search: path.basename(filename)
    });

  if (error) {
    return false;
  }

  return data.some(file => file.name === path.basename(filename));
}

/**
 * Extract filename from a Supabase Storage public URL
 * @param {string} publicUrl - The public URL
 * @returns {string|null} - The filename or null if not a valid storage URL
 */
function getFilenameFromUrl(publicUrl) {
  if (!publicUrl) return null;

  // URL format: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{filename}
  const match = publicUrl.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)$/);
  return match ? match[1] : null;
}

/**
 * Extract bucket name from a Supabase Storage public URL
 * @param {string} publicUrl - The public URL
 * @returns {string|null} - The bucket name or null if not a valid storage URL
 */
function getBucketFromUrl(publicUrl) {
  if (!publicUrl) return null;

  // URL format: https://{project}.supabase.co/storage/v1/object/public/{bucket}/{filename}
  const match = publicUrl.match(/\/storage\/v1\/object\/public\/([^/]+)\//);
  return match ? match[1] : null;
}

module.exports = {
  BUCKETS,
  uploadFile,
  uploadFileFromPath,
  getPublicUrl,
  deleteFile,
  downloadFile,
  copyFile,
  fileExists,
  getFilenameFromUrl,
  getBucketFromUrl
};
