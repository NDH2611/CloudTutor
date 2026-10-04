import axios from 'axios';
import { INITIAL_MOCK_JOBS } from './mockData';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false' || !API_BASE_URL;

// Local storage key for persisting jobs during frontend testing
const LOCAL_STORAGE_JOBS_KEY = 'cloudtutor_jobs_v1';

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

/**
 * Create a new Lecture Job
 * Contract: POST /jobs -> { job_id, presigned_url, status, s3_key }
 */
export async function createJob({ fileName, fileSize, contentType = 'video/mp4', token = '' }) {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 600)); // Simulate API Gateway latency
    const jobId = 'job-' + Math.random().toString(36).substring(2, 10);
    const mockPresignedUrl = `https://cloudtutor-bucket.s3.ap-southeast-1.amazonaws.com/videos/mock_user/${jobId}/${encodeURIComponent(fileName)}?AWSAccessKeyId=MOCK&Signature=MOCK&Expires=1800`;
    
    const newJob = {
      job_id: jobId,
      file_name: fileName,
      file_size: fileSize,
      format: contentType,
      status: 'CREATED',
      created_at: new Date().toISOString(),
      presigned_url: mockPresignedUrl,
      s3_key: `videos/mock_user/${jobId}/${fileName}`,
      total_tasks: 4,
      completed_tasks: 0,
      failed_tasks: 0,
      summary_preview: 'Job created. Ready for cloud worker processing pipeline.'
    };

    const currentJobs = getStoredJobs();
    saveStoredJobs([newJob, ...currentJobs]);

    return {
      job_id: jobId,
      presigned_url: mockPresignedUrl,
      status: 'CREATED',
      s3_key: newJob.s3_key,
      isMock: true
    };
  }

  // Live API Gateway call
  const response = await axios.post(
    `${API_BASE_URL}/jobs`,
    {
      file_name: fileName,
      file_size: fileSize,
      content_type: contentType
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
}

/**
 * Upload Video to S3 directly via Presigned URL
 */
export async function uploadToS3(presignedUrl, file, onProgress, abortSignal) {
  if (USE_MOCK || presignedUrl.includes('mock_user') || presignedUrl.includes('AWSAccessKeyId=MOCK')) {
    // Realistic upload simulation with chunking and progress callback
    return new Promise((resolve, reject) => {
      let currentProgress = 0;
      const interval = setInterval(() => {
        if (abortSignal && abortSignal.aborted) {
          clearInterval(interval);
          reject(new Error('Upload bị hủy bởi người dùng'));
          return;
        }

        // Increment between 8% and 20%
        currentProgress += Math.floor(Math.random() * 12) + 8;
        if (currentProgress >= 100) {
          currentProgress = 100;
          clearInterval(interval);
          onProgress(100);
          
          // Update status in local storage to UPLOADED
          const jobs = getStoredJobs();
          const updated = jobs.map(j => {
            if (presignedUrl.includes(j.job_id)) {
              return { ...j, status: 'UPLOADED' };
            }
            return j;
          });
          saveStoredJobs(updated);

          setTimeout(() => {
            resolve({
              status: 200,
              message: 'Mock S3 PUT 200 OK (ETag: "9b2cf535f27731c974343645a3985328")'
            });
          }, 300);
        } else {
          onProgress(currentProgress);
        }
      }, 250);
    });
  }

  // Live direct S3 PUT
  return axios.put(presignedUrl, file, {
    headers: {
      'Content-Type': file.type || 'video/mp4'
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
 */
export async function fetchJobs(token = '') {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300));
    return getStoredJobs();
  }

  const res = await axios.get(`${API_BASE_URL}/jobs`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  return res.data.jobs || res.data;
}

/**
 * Delete a job (for library management testing)
 */
export async function deleteJob(jobId, token = '') {
  if (USE_MOCK) {
    const jobs = getStoredJobs().filter(j => j.job_id !== jobId);
    saveStoredJobs(jobs);
    return { success: true };
  }

  await axios.delete(`${API_BASE_URL}/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return { success: true };
}
