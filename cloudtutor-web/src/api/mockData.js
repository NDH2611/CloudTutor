// Mock data for CloudTutor frontend

export const INITIAL_MOCK_JOBS = [
  {
    job_id: 'job-98a4b12c',
    file_name: 'CS101_Distributed_Systems_Lecture1.mp4',
    original_filename: 'CS101_Distributed_Systems_Lecture1.mp4',
    file_size: 48500000, // ~48.5MB
    format: 'video/mp4',
    status: 'COMPLETED',
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(), // 4h ago
    duration: '42:15',
    total_tasks: 8,
    completed_tasks: 8,
    failed_tasks: 0,
    summary_preview: 'Tổng quan về hệ thống phân tán, thuật toán đồng thuận Paxos/Raft và định lý CAP trên Cloud.',
    s3_key: 'videos/usr-demo1/job-98a4b12c/lecture.mp4'
  },
  {
    job_id: 'job-55d2f83e',
    file_name: 'AWS_Solutions_Architect_Module3.mp4',
    original_filename: 'AWS_Solutions_Architect_Module3.mp4',
    file_size: 72100000, // ~72MB
    format: 'video/mp4',
    status: 'PROCESSING_AI',
    created_at: new Date(Date.now() - 3600000 * 1).toISOString(), // 1h ago
    duration: '35:20',
    total_tasks: 6,
    completed_tasks: 4,
    failed_tasks: 0,
    summary_preview: 'Transcribing hoàn tất. Bedrock đang phân tích chunk và sinh câu hỏi trắc nghiệm...',
    s3_key: 'videos/usr-demo1/job-55d2f83e/lecture.mp4'
  },
  {
    job_id: 'job-17c9e041',
    file_name: 'MachineLearning_Transformers_Attention.mp4',
    original_filename: 'MachineLearning_Transformers_Attention.mp4',
    file_size: 110400000, // ~110MB
    format: 'video/mp4',
    status: 'COMPLETED_WITH_WARNING',
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(), // 1 day ago
    duration: '58:00',
    total_tasks: 12,
    completed_tasks: 11,
    failed_tasks: 1,
    summary_preview: 'Cơ chế Self-Attention và Transformer. Video không có tiếng, đã kích hoạt trích xuất OCR qua Rekognition.',
    s3_key: 'videos/usr-demo1/job-17c9e041/lecture.mp4'
  }
];

export const MOCK_JOB_DETAILS = {
  'job-98a4b12c': {
    job_id: 'job-98a4b12c',
    original_filename: 'CS101_Distributed_Systems_Lecture1.mp4',
    status: 'COMPLETED',
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    content_source: 'ASR',
    warnings: [],
    error_code: null,
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    chunks: [
      {
        chunk_id: 'chunk_0001',
        start_time: 0,
        end_time: 14.5,
        text: 'Chào mừng các bạn đến với môn học Kiến trúc Hệ thống Phân tán và Điện toán Đám mây. Trong bài mở đầu hôm nay, chúng ta sẽ làm quen với khái niệm cốt lõi.'
      },
      {
        chunk_id: 'chunk_0002',
        start_time: 15,
        end_time: 32.2,
        text: 'Một hệ thống phân tán bao gồm nhiều nút độc lập kết nối qua mạng máy tính, cùng phối hợp để giải quyết một bài toán tính toán quy mô lớn.'
      },
      {
        chunk_id: 'chunk_0003',
        start_time: 33,
        end_time: 52.8,
        text: 'Định lý CAP (Consistency, Availability, Partition Tolerance) chỉ ra rằng một hệ thống phân tán chỉ có thể đảm bảo tối đa hai trong ba yếu tố cùng lúc.'
      },
      {
        chunk_id: 'chunk_0004',
        start_time: 53.5,
        end_time: 75.0,
        text: 'Trong kiến trúc Cloud-native, việc phân tách stateless compute (như AWS Lambda) và state storage (như Amazon S3, DynamoDB) là nguyên tắc tối quan trọng.'
      },
      {
        chunk_id: 'chunk_0005',
        start_time: 76.0,
        end_time: 98.4,
        text: 'Để xử lý các tác vụ nặng bất đồng bộ, chúng ta sử dụng Message Queue như Amazon SQS kết hợp Dead Letter Queue (DLQ) nhằm đảm bảo khả năng chịu lỗi fault-tolerance.'
      }
    ],
    summary: {
      title: 'Tóm Tắt Bài Giảng: Nguyên Lý Hệ Thống Phân Tán',
      overview: 'Bài giảng cung cấp kiến thức nền tảng về tính phân tán, định lý CAP và mô hình thiết kế Serverless-first trên nền tảng đám mây AWS.',
      key_points: [
        'Hệ thống phân tán: Tập hợp các node máy tính liên kết qua mạng truyền thông, hướng đến tính mở rộng cao (Scalability).',
        'Định lý CAP: Trong môi trường mạng có độ trễ hoặc lỗi phân vùng (Partition), hệ thống buộc phải đánh đổi giữa Tính nhất quán (Consistency) và Tính khả dụng (Availability).',
        'Tách biệt Compute & Storage: Giúp mở rộng độc lập giữa tầng tính toán (Lambda, EC2) và tầng lưu trữ dữ liệu (S3, DynamoDB).',
        'Cơ chế chịu lỗi (Fault Tolerance): Ứng dụng mô hình SQS Worker + DLQ giúp hệ thống tự động thử lại (Retry) và cô lập thông điệp hỏng mà không làm sập pipeline.'
      ],
      recommendations: 'Cần lưu ý thiết kế idempotency cho các worker nhận message từ hàng đợi SQS để tránh xử lý trùng lặp khi có retry.'
    },
    quiz: {
      title: 'Bộ Câu Hỏi Ôn Tập Kiến Trúc Phân Tán',
      questions: [
        {
          id: 1,
          question: 'Theo định lý CAP, khi xảy ra sự cố phân vùng mạng (Network Partition), hệ thống bắt buộc phải đánh đổi giữa 2 yếu tố nào?',
          options: [
            'Consistency (Tính nhất quán) và Availability (Tính khả dụng)',
            'Latency (Độ trễ) và Throughput (Băng thông)',
            'Security (Bảo mật) và Scalability (Khả năng mở rộng)',
            'Cost (Chi phí) và Memory (Bộ nhớ)'
          ],
          correct_index: 0,
          explanation: 'Định lý CAP khẳng định khi có Partition (P), hệ thống chỉ có thể chọn CP (đảm bảo nhất quán, từ chối một số truy vấn) hoặc AP (đảm bảo phản hồi nhưng dữ liệu có thể chưa đồng bộ).'
        },
        {
          id: 2,
          question: 'Thành phần nào trong kiến trúc AWS giúp nhận thông điệp thất bại sau nhiều lần thử lại để ngăn ngừa nghẽn hàng đợi chính?',
          options: [
            'Amazon CloudWatch Logs',
            'Dead Letter Queue (DLQ)',
            'Amazon Route 53',
            'Amazon Cognito User Pool'
          ],
          correct_index: 1,
          explanation: 'Dead Letter Queue (DLQ) là hàng đợi đặc biệt dùng để lưu giữ các message xử lý thất bại nhiều lần (vượt quá maxReceiveCount) nhằm mục đích điều tra và khôi phục sau.'
        },
        {
          id: 3,
          question: 'Tại sao S3 Presigned URL lại là lựa chọn tối ưu cho việc upload video trực tiếp từ trình duyệt web?',
          options: [
            'Vì nó giúp mã hóa video bằng thuật toán lượng tử',
            'Vì nó cho phép client upload thẳng lên S3 mà không cần đi qua backend, tiết kiệm băng thông và tài nguyên máy chủ',
            'Vì nó cho phép upload không giới hạn dung lượng và không bao giờ hết hạn',
            'Vì nó thay thế hoàn toàn hệ thống xác thực người dùng'
          ],
          correct_index: 1,
          explanation: 'Presigned URL cho phép client tương tác trực tiếp với S3 bucket an toàn trong thời gian có hạn (ví dụ 15 phút), giảm tải triệt để cho API server.'
        }
      ]
    }
  },
  'job-17c9e041': {
    job_id: 'job-17c9e041',
    original_filename: 'MachineLearning_Transformers_Attention.mp4',
    status: 'COMPLETED_WITH_WARNING',
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    content_source: 'OCR',
    warnings: [
      'ASR_EMPTY',
      'OCR_TIMESTAMPS_ARE_SAMPLED',
      'OCR_TEXT_REQUIRES_REVIEW'
    ],
    error_code: null,
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    chunks: [
      {
        chunk_id: 'chunk_ocr_0001',
        start_time: 0,
        end_time: 10,
        text: 'SLIDE 1: TRANSFORMERS ARCHITECTURE & SELF-ATTENTION MECHANISM\nGiới thiệu mô hình mạng nơ-ron Attention Is All You Need (Vaswani et al.)'
      },
      {
        chunk_id: 'chunk_ocr_0002',
        start_time: 10,
        end_time: 25,
        text: 'SLIDE 2: SCALED DOT-PRODUCT ATTENTION FORMULA\nAttention(Q, K, V) = softmax(Q * K^T / sqrt(d_k)) * V\nTrong đó Q là Query, K là Key, V là Value.'
      },
      {
        chunk_id: 'chunk_ocr_0003',
        start_time: 25,
        end_time: 45,
        text: 'SLIDE 3: MULTI-HEAD ATTENTION\nChia Q, K, V thành nhiều head chiếu không gian con, cho phép mô hình học các mối quan hệ ngữ nghĩa ở nhiều khía cạnh khác nhau.'
      }
    ],
    summary: {
      title: 'Tóm Tắt Bài Giảng (Trích Xuất Từ Hình Ảnh Slide)',
      overview: 'Video không có âm thanh giọng nói. Hệ thống đã tự động kích hoạt pipeline OCR trích xuất văn bản từ khung hình video qua Amazon Rekognition.',
      key_points: [
        'Cơ chế Attention: Thay thế mạng hồi quy RNN truyền thống, giải quyết triệt để vấn đề mất thông tin ngữ cảnh dài.',
        'Công thức Scaled Dot-Product: Sử dụng hệ số tỷ lệ căn bậc hai của d_k để tránh hiện tượng đạo hàm biến mất ở hàm Softmax.',
        'Multi-Head Attention: Mở rộng khả năng biểu diễn của mô hình bằng cách chiếu dữ liệu vào nhiều không gian vector độc lập.'
      ],
      recommendations: 'Nội dung được trích xuất tự động bằng OCR hình ảnh, người học nên kiểm tra lại các ký hiệu công thức toán học.'
    },
    quiz: {
      title: 'Bộ Câu Hỏi Kiểm Tra Kiến Thức Transformer (OCR Generated)',
      questions: [
        {
          id: 1,
          question: 'Ba thành phần đầu vào chính trong công thức Attention của Transformer là gì?',
          options: [
            'Query (Q), Key (K), và Value (V)',
            'Weights (W), Bias (B), và Activation (A)',
            'Encoder, Decoder, và Bottleneck',
            'Learning Rate, Epoch, và Batch Size'
          ],
          correct_index: 0,
          explanation: 'Cơ chế Self-Attention tính toán độ tương đồng giữa Query và Key để gán trọng số cho Value.'
        }
      ]
    }
  }
};

export const MOCK_USER = {
  username: 'student_cloudtutor',
  email: 'student@cloudtutor.edu.vn',
  name: 'Nguyễn Văn A',
  sub: 'usr-demo1-aws-cognito-id',
  role: 'Student / Researcher'
};
