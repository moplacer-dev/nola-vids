const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const STORAGE_DIR = path.join(__dirname, '..', 'storage');

// In-memory job storage (in production, use Redis or a database)
const jobs = new Map();

class JobManager {
  constructor(veoService) {
    this.veoService = veoService;
    this.pollInterval = 10000; // 10 seconds
    this.activePollers = new Map();
  }

  // Create a new job
  createJob(type, params) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      type,
      params,
      status: 'pending',
      operationData: null,  // Store full operation object for polling
      operationName: null,  // Human-readable operation name
      videos: [],
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    jobs.set(jobId, job);
    return job;
  }

  // Start a generation job
  async startJob(jobId) {
    const job = jobs.get(jobId);
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

      // Start polling for completion
      this._startPolling(jobId);

      return job;
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      job.updatedAt = new Date().toISOString();
      throw error;
    }
  }

  // Poll for job completion
  _startPolling(jobId) {
    const poller = setInterval(async () => {
      const job = jobs.get(jobId);
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

          // Download videos
          const downloadedVideos = [];
          for (let i = 0; i < status.videos.length; i++) {
            const video = status.videos[i];
            if (video.uri) {
              const filename = `${jobId}_${i}.mp4`;
              const outputPath = path.join(STORAGE_DIR, filename);
              await this.veoService.downloadVideo(video.uri, outputPath);
              downloadedVideos.push({
                filename,
                path: `/videos/${filename}`,
                mimeType: video.mimeType
              });
            }
          }

          job.videos = downloadedVideos;
          job.status = 'completed';
          job.updatedAt = new Date().toISOString();
        } else if (status.status === 'failed') {
          clearInterval(poller);
          this.activePollers.delete(jobId);

          job.status = 'failed';
          job.error = status.error;
          job.updatedAt = new Date().toISOString();
        }
      } catch (error) {
        console.error(`Polling error for job ${jobId}:`, error.message);
      }
    }, this.pollInterval);

    this.activePollers.set(jobId, poller);
  }

  // Get job by ID
  getJob(jobId) {
    return jobs.get(jobId) || null;
  }

  // Get all jobs
  getAllJobs() {
    return Array.from(jobs.values()).sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  // Delete a job
  deleteJob(jobId) {
    const job = jobs.get(jobId);
    if (job) {
      // Stop polling if active
      if (this.activePollers.has(jobId)) {
        clearInterval(this.activePollers.get(jobId));
        this.activePollers.delete(jobId);
      }

      // Delete video files
      for (const video of job.videos) {
        const filePath = path.join(STORAGE_DIR, video.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      jobs.delete(jobId);
      return true;
    }
    return false;
  }
}

module.exports = JobManager;
