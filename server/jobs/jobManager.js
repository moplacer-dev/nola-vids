const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { jobs: jobDb, videos: videoDb } = require('../db/database');

const STORAGE_DIR = path.join(__dirname, '..', 'storage');

class JobManager {
  constructor(veoService) {
    this.veoService = veoService;
    this.pollInterval = 10000; // 10 seconds
    this.activePollers = new Map();

    // Resume polling for any processing jobs on startup
    this._resumeProcessingJobs();
  }

  // Resume polling for jobs that were processing when server stopped
  _resumeProcessingJobs() {
    const processingJobs = jobDb.getByStatus('processing');
    for (const job of processingJobs) {
      if (job.operationData) {
        console.log(`Resuming polling for job ${job.id}`);
        this._startPolling(job.id);
      }
    }
  }

  // Create a new job
  createJob(type, params) {
    const jobId = uuidv4();
    const now = new Date().toISOString();
    const job = {
      id: jobId,
      type,
      params,
      status: 'pending',
      operationData: null,
      operationName: null,
      error: null,
      createdAt: now,
      updatedAt: now
    };

    jobDb.create(job);
    return job;
  }

  // Start a generation job
  async startJob(jobId) {
    const job = jobDb.getById(jobId);
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

      job.operationData = result.operationData;
      job.operationName = result.operationName;
      job.status = 'processing';
      job.updatedAt = new Date().toISOString();

      jobDb.update(job);

      // Start polling for completion
      this._startPolling(jobId);

      return job;
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date().toISOString();
      jobDb.update(job);
      throw error;
    }
  }

  // Poll for job completion
  _startPolling(jobId) {
    const poller = setInterval(async () => {
      const job = jobDb.getById(jobId);
      if (!job || !job.operationData) {
        clearInterval(poller);
        this.activePollers.delete(jobId);
        return;
      }

      try {
        const status = await this.veoService.checkOperation(job.operationData);

        // Update operation data if returned (for next poll)
        if (status.operationData) {
          job.operationData = status.operationData;
        }

        if (status.status === 'completed') {
          clearInterval(poller);
          this.activePollers.delete(jobId);

          // Download videos and create video records
          for (let i = 0; i < status.videos.length; i++) {
            const video = status.videos[i];
            if (video.uri) {
              const filename = `${jobId}_${i}.mp4`;
              const outputPath = path.join(STORAGE_DIR, filename);
              await this.veoService.downloadVideo(video.uri, outputPath);

              // Create video record in database
              videoDb.create({
                id: uuidv4(),
                jobId: jobId,
                filename: filename,
                path: `/videos/${filename}`,
                mimeType: video.mimeType || 'video/mp4',
                title: null,
                folder: null,
                createdAt: new Date().toISOString()
              });
            }
          }

          job.status = 'completed';
          job.updatedAt = new Date().toISOString();
          jobDb.update(job);
        } else if (status.status === 'failed') {
          clearInterval(poller);
          this.activePollers.delete(jobId);

          job.status = 'failed';
          job.error = status.error;
          job.updatedAt = new Date().toISOString();
          jobDb.update(job);
        } else {
          // Still processing, just update operation data
          job.updatedAt = new Date().toISOString();
          jobDb.update(job);
        }
      } catch (error) {
        console.error(`Polling error for job ${jobId}:`, error.message);
      }
    }, this.pollInterval);

    this.activePollers.set(jobId, poller);
  }

  // Get job by ID (includes videos)
  getJob(jobId) {
    const job = jobDb.getById(jobId);
    if (!job) return null;

    // Attach videos to job
    const videos = videoDb.getByJobId(jobId);
    job.videos = videos.map(v => ({
      id: v.id,
      filename: v.filename,
      path: v.path,
      mimeType: v.mime_type,
      title: v.title,
      folder: v.folder
    }));

    return job;
  }

  // Get all jobs (includes videos)
  getAllJobs() {
    const jobs = jobDb.getAll();

    // Attach videos to each job
    for (const job of jobs) {
      const videos = videoDb.getByJobId(job.id);
      job.videos = videos.map(v => ({
        id: v.id,
        filename: v.filename,
        path: v.path,
        mimeType: v.mime_type,
        title: v.title,
        folder: v.folder
      }));
    }

    return jobs;
  }

  // Delete a job and its videos
  deleteJob(jobId) {
    const job = jobDb.getById(jobId);
    if (!job) return false;

    // Stop polling if active
    if (this.activePollers.has(jobId)) {
      clearInterval(this.activePollers.get(jobId));
      this.activePollers.delete(jobId);
    }

    // Get videos before deleting
    const videos = videoDb.getByJobId(jobId);

    // Delete video files from disk
    for (const video of videos) {
      const filePath = path.join(STORAGE_DIR, video.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Delete from database (cascades to videos)
    jobDb.delete(jobId);
    return true;
  }
}

module.exports = JobManager;
