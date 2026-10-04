// Mock data for CloudTutor frontend

export const INITIAL_MOCK_JOBS = [
  {
    job_id: 'job-98a4b12c',
    file_name: 'CS101_Distributed_Systems_Lecture1.mp4',
    file_size: 48500000, // ~48.5MB
    format: 'video/mp4',
    status: 'COMPLETED',
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(), // 4h ago
    duration: '42:15',
    total_tasks: 8,
    completed_tasks: 8,
    failed_tasks: 0,
    summary_preview: 'Introduction to consensus algorithms, Paxos vs Raft fundamentals, and CAP theorem trade-offs in cloud workloads.',
    s3_key: 'videos/usr-demo1/job-98a4b12c/lecture.mp4'
  },
  {
    job_id: 'job-55d2f83e',
    file_name: 'AWS_Solutions_Architect_Module3.mp4',
    file_size: 72100000, // ~72MB
    format: 'video/mp4',
    status: 'PROCESSING_AI',
    created_at: new Date(Date.now() - 3600000 * 1).toISOString(), // 1h ago
    duration: '35:20',
    total_tasks: 6,
    completed_tasks: 4,
    failed_tasks: 0,
    summary_preview: 'Transcribing completed. Bedrock is currently generating summary and quiz questions...',
    s3_key: 'videos/usr-demo1/job-55d2f83e/lecture.mp4'
  },
  {
    job_id: 'job-17c9e041',
    file_name: 'MachineLearning_Transformers_Attention.mp4',
    file_size: 110400000, // ~110MB
    format: 'video/mp4',
    status: 'COMPLETED_WITH_WARNING',
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(), // 1 day ago
    duration: '58:00',
    total_tasks: 12,
    completed_tasks: 11,
    failed_tasks: 1,
    summary_preview: 'Self-attention mechanism and multi-head scaling. 1 segment had audio clipping warning but processed successfully.',
    s3_key: 'videos/usr-demo1/job-17c9e041/lecture.mp4'
  }
];

export const MOCK_USER = {
  username: 'student_cloudtutor',
  email: 'student@cloudtutor.edu.vn',
  name: 'Nguyễn Văn A',
  sub: 'usr-demo1-aws-cognito-id',
  role: 'Student / Researcher'
};
