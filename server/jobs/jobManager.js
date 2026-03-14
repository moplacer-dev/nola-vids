const { v4: uuidv4 } = require('uuid');
const { jobs: jobDb, videos: videoDb } = require('../db/database');
const storage = require('../services/storage');
const { BUCKETS } = storage;

class JobManager {
  constructor(veoService) {
    this.veoService = veoService;
    this.basePollingInterval = 30000; // 30 seconds base polling interval
    this.maxPollingInterval = 120000; // Max 2 minutes between polls
    this.activePollers = new Map(); // jobId -> timeoutId
    this.maxConcurrentJobs = 2; // Max jobs processing at once
    this.pendingQueue = []; // Queue of job IDs waiting to start

    // Resume polling for any processing jobs on startup (async initialization)
    this._resumeProcessingJobs();
  }

  // Resume polling for jobs that were processing when server stopped
  async _resumeProcessingJobs() {
    try {
      const processingJobs = await jobDb.getByStatus('processing');
      for (const job of processingJobs) {
        if (job.operationName) {
          console.log(`Resuming polling for job ${job.id}`);
          this._startPolling(job.id);
        }
      }

      // Also resume any queued jobs
      const queuedJobs = await jobDb.getByStatus('queued');
      for (const job of queuedJobs) {
        console.log(`Re-queuing job ${job.id}`);
        this.pendingQueue.push(job.id);
      }

      // Process queue if capacity available
      this._processQueue();
    } catch (error) {
      console.error('Error resuming processing jobs:', error.message);
    }
  }

  // Get count of currently processing jobs
  _getProcessingCount() {
    return this.activePollers.size;
  }

  // Check if we have capacity to start a new job
  _hasCapacity() {
    return this._getProcessingCount() < this.maxConcurrentJobs;
  }

  // Process queued jobs when capacity frees up
  async _processQueue() {
    while (this._hasCapacity() && this.pendingQueue.length > 0) {
      const jobId = this.pendingQueue.shift();
      const job = await jobDb.getById(jobId);

      if (!job) continue;

      // Skip if job was deleted or is no longer queued
      if (job.status !== 'queued') continue;

      console.log(`Processing queued job ${jobId} (${this.pendingQueue.length} remaining in queue)`);

      try {
        await this._executeJob(jobId);
      } catch (error) {
        console.error(`Failed to execute queued job ${jobId}:`, error.message);
      }
    }
  }

  // Create a new job
  async createJob(type, params) {
    const jobId = uuidv4();
    const now = new Date().toISOString();
    const job = {
      id: jobId,
      type,
      params,
      status: 'pending',
      operationName: null,
      error: null,
      createdAt: now,
      updatedAt: now
    };

    await jobDb.create(job);
    return job;
  }

  // Start a generation job (with queue support)
  async startJob(jobId) {
    const job = await jobDb.getById(jobId);
    if (!job) throw new Error('Job not found');

    // Check if we have capacity
    if (!this._hasCapacity()) {
      // Queue the job
      job.status = 'queued';
      job.updatedAt = new Date().toISOString();
      await jobDb.update(job);

      this.pendingQueue.push(jobId);
      console.log(`Job ${jobId} queued (position ${this.pendingQueue.length}, ${this._getProcessingCount()}/${this.maxConcurrentJobs} processing)`);

      return job;
    }

    // Execute immediately
    return this._executeJob(jobId);
  }

  // Actually execute a job (internal method)
  async _executeJob(jobId) {
    const job = await jobDb.getById(jobId);
    if (!job) throw new Error('Job not found');

    try {
      let result;

      switch (job.type) {
        case 'text-to-video':
          result = await this.veoService.generateFromText(job.params);
          break;
        case 'image-to-video':
          result = await this.veoService.generateFromImage(job.params);
          break;
        case 'frame-interpolation':
          result = await this.veoService.generateFromFrames(job.params);
          break;
        case 'reference-guided':
          result = await this.veoService.generateWithReferences(job.params);
          break;
        case 'video-extension':
          result = await this.veoService.extendVideo(job.params);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      job.operationName = result.operationName;
      job.status = 'processing';
      job.updatedAt = new Date().toISOString();

      await jobDb.update(job);

      // Start polling for completion
      this._startPolling(jobId);

      return job;
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date().toISOString();
      await jobDb.update(job);

      // Process queue since this job failed
      this._processQueue();

      throw error;
    }
  }

  // Poll for job completion with exponential backoff
  _startPolling(jobId, pollCount = 0) {
    // Calculate interval with exponential backoff
    const interval = Math.min(
      this.basePollingInterval * Math.pow(1.5, Math.floor(pollCount / 3)),
      this.maxPollingInterval
    );

    const timeoutId = setTimeout(async () => {
      const job = await jobDb.getById(jobId);
      if (!job || !job.operationName) {
        this.activePollers.delete(jobId);
        this._processQueue();
        return;
      }

      try {
        const status = await this.veoService.checkOperation(job.operationName);

        // Update operation name if returned (for next poll)
        if (status.operationName) {
          job.operationName = status.operationName;
        }

        if (status.status === 'completed') {
          this.activePollers.delete(jobId);

          // Download videos and upload to Supabase Storage
          for (let i = 0; i < status.videos.length; i++) {
            const video = status.videos[i];
            if (video.uri) {
              const filename = `${jobId}_${i}.mp4`;

              // Download video to buffer
              const videoBuffer = await this.veoService.downloadVideoToBuffer(video.uri);

              // Upload to Supabase Storage
              const uploaded = await storage.uploadFile(
                BUCKETS.VIDEOS,
                filename,
                videoBuffer,
                video.mimeType || 'video/mp4'
              );

              // Create video record in database (store source URI for video extension)
              await videoDb.create({
                id: uuidv4(),
                jobId: jobId,
                filename: filename,
                path: uploaded.publicUrl,
                mimeType: video.mimeType || 'video/mp4',
                title: null,
                folder: null,
                sourceUri: video.uri,
                createdAt: new Date().toISOString()
              });
            }
          }

          job.status = 'completed';
          job.updatedAt = new Date().toISOString();
          await jobDb.update(job);

          // Process queue since capacity freed up
          this._processQueue();
        } else if (status.status === 'failed') {
          this.activePollers.delete(jobId);

          job.status = 'failed';
          job.error = status.error;
          job.updatedAt = new Date().toISOString();
          await jobDb.update(job);

          // Process queue since capacity freed up
          this._processQueue();
        } else {
          // Still processing, schedule next poll with backoff
          job.updatedAt = new Date().toISOString();
          await jobDb.update(job);

          this._startPolling(jobId, pollCount + 1);
        }
      } catch (error) {
        console.error(`Polling error for job ${jobId}:`, error.message);
        // Continue polling despite errors
        this._startPolling(jobId, pollCount + 1);
      }
    }, pollCount === 0 ? 0 : interval); // First poll immediately for resumed jobs

    this.activePollers.set(jobId, timeoutId);
  }

  // Get job by ID (includes videos)
  async getJob(jobId) {
    const job = await jobDb.getById(jobId);
    if (!job) return null;

    // Add queue position if queued
    if (job.status === 'queued') {
      const queuePosition = this.pendingQueue.indexOf(jobId);
      job.queuePosition = queuePosition >= 0 ? queuePosition + 1 : null;
    }

    // Attach videos to job
    const videos = await videoDb.getByJobId(jobId);
    job.videos = videos.map(v => ({
      id: v.id,
      filename: v.filename,
      path: v.path,
      mimeType: v.mimeType,
      title: v.title,
      folder: v.folder
    }));

    return job;
  }

  // Get all jobs (includes videos)
  async getAllJobs() {
    const jobs = await jobDb.getAll();

    // Attach videos and queue position to each job
    for (const job of jobs) {
      if (job.status === 'queued') {
        const queuePosition = this.pendingQueue.indexOf(job.id);
        job.queuePosition = queuePosition >= 0 ? queuePosition + 1 : null;
      }

      const videos = await videoDb.getByJobId(job.id);
      job.videos = videos.map(v => ({
        id: v.id,
        filename: v.filename,
        path: v.path,
        mimeType: v.mimeType,
        title: v.title,
        folder: v.folder
      }));
    }

    return jobs;
  }

  // Delete a job and its videos
  async deleteJob(jobId) {
    const job = await jobDb.getById(jobId);
    if (!job) return false;

    // Stop polling if active
    if (this.activePollers.has(jobId)) {
      clearTimeout(this.activePollers.get(jobId));
      this.activePollers.delete(jobId);
    }

    // Remove from pending queue if queued
    const queueIndex = this.pendingQueue.indexOf(jobId);
    if (queueIndex >= 0) {
      this.pendingQueue.splice(queueIndex, 1);
    }

    // Get videos before deleting
    const videos = await videoDb.getByJobId(jobId);

    // Delete video files from Supabase Storage
    for (const video of videos) {
      const filename = storage.getFilenameFromUrl(video.path);
      if (filename) {
        await storage.deleteFile(BUCKETS.VIDEOS, filename);
      }
    }

    // Delete from database (cascades to videos)
    await jobDb.delete(jobId);

    // Process queue in case we freed up capacity
    this._processQueue();

    return true;
  }
}

module.exports = JobManager;
