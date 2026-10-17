import axios from 'axios';
import { INITIAL_MOCK_JOBS, MOCK_JOB_DETAILS } from './mockData';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || !API_BASE_URL;

// Local storage key for persisting jobs during frontend testing
const LOCAL_STORAGE_JOBS_KEY = 'cloudtutor_jobs_v1';
const LOCAL_STORAGE_DETAILS_KEY = 'cloudtutor_job_details_v1';

function getStoredJobs() {
  const saved = localStorage.getItem(LOCAL_STORAGE_JOBS_KEY);
  if (!saved) {
    localStorage.setItem(LOCAL_STORAGE_JOBS_KEY, JSON.stringify(INITIAL_MOCK_JOBS));
    return INITIAL_MOCK_JOBS;
  }
  try {
    return JSON.parse(saved);
  } catch {
    return INITIAL_MOCK_JOBS;
  }
}

function saveStoredJobs(jobs) {
  localStorage.setItem(LOCAL_STORAGE_JOBS_KEY, JSON.stringify(jobs));
}

function getStoredDetails() {
  const saved = localStorage.getItem(LOCAL_STORAGE_DETAILS_KEY);
  if (!saved) {
    localStorage.setItem(LOCAL_STORAGE_DETAILS_KEY, JSON.stringify(MOCK_JOB_DETAILS));
    return MOCK_JOB_DETAILS;
  }
  try {
    return { ...MOCK_JOB_DETAILS, ...JSON.parse(saved) };
  } catch {
    return MOCK_JOB_DETAILS;
  }
}

function saveStoredDetails(details) {
  localStorage.setItem(LOCAL_STORAGE_DETAILS_KEY, JSON.stringify(details));
}

/**
 * Create a new Lecture Job
 * Contract (router.js): POST /jobs { filename } 
 * -> { job_id, status: "CREATED", upload_url, upload_headers: { "Content-Type": "video/mp4" }, expires_in: 900 }
 */
export async function createJob({ fileName, fileSize = 0, token = '' }) {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 500)); // Simulate API Gateway latency
    const jobId = 'job-' + Math.random().toString(36).substring(2, 10);
    const mockUploadUrl = `https://s3-cloudtutor-media-mock.s3.ap-southeast-1.amazonaws.com/videos/mock_user/${jobId}/source.mp4?mock=true`;

    const newJob = {
      job_id: jobId,
      original_filename: fileName || 'lecture.mp4',
      file_name: fileName || 'lecture.mp4',
      file_size: fileSize,
      status: 'CREATED',
      created_at: new Date().toISOString(),
      upload_url: mockUploadUrl,
      presigned_url: mockUploadUrl,
      warnings: [],
      error_code: null
    };

    const currentJobs = getStoredJobs();
    saveStoredJobs([newJob, ...currentJobs]);

    // Initialize mock detail for this job in processing state
    const currentDetails = getStoredDetails();
    currentDetails[jobId] = {
      job_id: jobId,
      original_filename: fileName,
      status: 'CREATED',
      created_at: newJob.created_at,
      warnings: [],
      error_code: null,
      video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      createdAtTimestamp: Date.now()
    };
    saveStoredDetails(currentDetails);

    return {
      job_id: jobId,
      status: 'CREATED',
      upload_url: mockUploadUrl,
      presigned_url: mockUploadUrl,
      upload_headers: { 'Content-Type': 'video/mp4' },
      expires_in: 900,
      isMock: true
    };
  }

  // Live API Gateway call matching cloudtutor-api/src/router.js contract
  const response = await axios.post(
    `${API_BASE_URL}/jobs`,
    {
      filename: fileName || 'source.mp4'
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return {
    job_id: response.data.job_id,
    status: response.data.status,
    upload_url: response.data.upload_url,
    presigned_url: response.data.upload_url,
    upload_headers: response.data.upload_headers || { 'Content-Type': 'video/mp4' },
    expires_in: response.data.expires_in,
    isMock: false
  };
}

/**
 * Upload Video to S3 directly via Presigned URL
 * Direct S3 PUT with Content-Type matching presigned signature (video/mp4)
 */
export async function uploadToS3(uploadUrl, file, onProgress, abortSignal) {
  if (USE_MOCK || uploadUrl.includes('mock_user') || uploadUrl.includes('mock=true')) {
    // Realistic upload simulation with chunking and progress callback
    return new Promise((resolve, reject) => {
      let currentProgress = 0;
      const interval = setInterval(() => {
        if (abortSignal && abortSignal.aborted) {
          clearInterval(interval);
          reject(new Error('Upload bị hủy bởi người dùng'));
          return;
        }

        currentProgress += Math.floor(Math.random() * 12) + 10;
        if (currentProgress >= 100) {
          currentProgress = 100;
          clearInterval(interval);
          onProgress(100);

          // Update status in local storage to QUEUED (ready for pipeline)
          const jobs = getStoredJobs();
          const updated = jobs.map((j) => {
            if (uploadUrl.includes(j.job_id)) {
              return { ...j, status: 'QUEUED' };
            }
            return j;
          });
          saveStoredJobs(updated);

          const details = getStoredDetails();
          for (const key in details) {
            if (uploadUrl.includes(key)) {
              details[key].status = 'QUEUED';
              details[key].uploadedAt = Date.now();
            }
          }
          saveStoredDetails(details);

          setTimeout(() => {
            resolve({
              status: 200,
              message: 'Mock S3 Direct PUT 200 OK (ETag: "9b2cf535f27731c974343645a3985328")'
            });
          }, 300);
        } else {
          onProgress(currentProgress);
        }
      }, 200);
    });
  }

  // Live direct S3 PUT binary upload
  return axios.put(uploadUrl, file, {
    headers: {
      'Content-Type': 'video/mp4'
    },
    signal: abortSignal,
    onUploadProgress: (progressEvent) => {
      if (progressEvent.total) {
        const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(percent);
      }
    }
  });
}

/**
 * Fetch list of all jobs for current user
 * Contract (router.js): GET /jobs?limit=20&next_token=...
 * -> { items: [{ job_id, status, original_filename, created_at }], next_token }
 */
export async function fetchJobs(token = '', limit = 20, nextToken = null) {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 250));
    return {
      items: getStoredJobs(),
      next_token: null
    };
  }

  const params = {};
  if (limit) params.limit = limit;
  if (nextToken) params.next_token = nextToken;

  const res = await axios.get(`${API_BASE_URL}/jobs`, {
    params,
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  return {
    items: res.data.items || res.data.jobs || (Array.isArray(res.data) ? res.data : []),
    next_token: res.data.next_token || null
  };
}

/**
 * Fetch complete Job Detail (including Video URL, Transcript chunks, Summary, Quiz)
 * Contract (router.js): GET /jobs/{id}
 * -> { job_id, status, original_filename, created_at, warnings, error_code, content_source, transcript, chunks, summary, quiz, video_url }
 */
export async function getJobDetail(jobId, token = '') {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300));
    const details = getStoredDetails();
    let detail = details[jobId];

    if (!detail) {
      // Check stored jobs list
      const jobs = getStoredJobs();
      const basicJob = jobs.find((j) => j.job_id === jobId);
      if (basicJob) {
        detail = {
          ...basicJob,
          content_source: 'ASR',
          warnings: [],
          video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
        };
      } else {
        throw new Error('NOT_FOUND');
      }
    }

    // In Mock mode: if job was recently created and uploaded, simulate pipeline progression
    if (detail.uploadedAt && detail.status !== 'COMPLETED') {
      const elapsed = Date.now() - detail.uploadedAt;
      if (elapsed < 3000) {
        detail.status = 'QUEUED';
      } else if (elapsed < 7000) {
        detail.status = 'TRANSCRIBING';
      } else if (elapsed < 12000) {
        detail.status = 'PROCESSING_AI';
      } else {
        detail.status = 'COMPLETED';
        detail.content_source = 'ASR';
        detail.chunks = MOCK_JOB_DETAILS['job-98a4b12c'].chunks;
        detail.summary = MOCK_JOB_DETAILS['job-98a4b12c'].summary;
        detail.quiz = MOCK_JOB_DETAILS['job-98a4b12c'].quiz;

        // Also update stored job list status
        const jobs = getStoredJobs();
        const updated = jobs.map((j) => (j.job_id === jobId ? { ...j, status: 'COMPLETED' } : j));
        saveStoredJobs(updated);
      }
      details[jobId] = detail;
      saveStoredDetails(details);
    }

    return detail;
  }

  const res = await axios.get(`${API_BASE_URL}/jobs/${jobId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  return res.data;
}

/**
 * Delete a job (marks DELETING, deletes S3 files, marks DELETED)
 * Contract (router.js): DELETE /jobs/{id} -> { job_id, status: "DELETED" }
 */
export async function deleteJob(jobId, token = '') {
  if (USE_MOCK) {
    const jobs = getStoredJobs().filter((j) => j.job_id !== jobId);
    saveStoredJobs(jobs);
    const details = getStoredDetails();
    delete details[jobId];
    saveStoredDetails(details);
    return { job_id: jobId, status: 'DELETED' };
  }

  const res = await axios.delete(`${API_BASE_URL}/jobs/${jobId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  return res.data;
}
