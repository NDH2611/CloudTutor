// Mock data for CloudTutor frontend

export const INITIAL_MOCK_JOBS = [
  {
    job_id: 'job_7048e75d-0975-4e59-abd0-53d173441d38',
    file_name: 'Transformers explained in under 3 minutes  Attention Is All You Need - Bidirectional AI (720p, h264).mp4',
    original_filename: 'Transformers explained in under 3 minutes  Attention Is All You Need - Bidirectional AI (720p, h264).mp4',
    file_size: 48500000,
    format: 'video/mp4',
    status: 'COMPLETED',
    created_at: '2026-11-04T03:38:47.433Z',
    duration: '02:53',
    total_tasks: 4,
    completed_tasks: 4,
    failed_tasks: 0,
    summary_preview: 'Bài giảng giải thích chi tiết về kiến trúc Transformer, cơ chế Self-Attention và ứng dụng trong GPT/BERT.',
    s3_key: 'videos/a94a056c-d031-70a5-32b9-b232c6735ae7/job_7048e75d-0975-4e59-abd0-53d173441d38/source.mp4'
  },
  {
    job_id: 'job-98a4b12c',
    file_name: 'CS101_Distributed_Systems_Lecture1.mp4',
    original_filename: 'CS101_Distributed_Systems_Lecture1.mp4',
    file_size: 48500000,
    format: 'video/mp4',
    status: 'COMPLETED',
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
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
    file_size: 72100000,
    format: 'video/mp4',
    status: 'PROCESSING_AI',
    created_at: new Date(Date.now() - 3600000 * 1).toISOString(),
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
    file_size: 110400000,
    format: 'video/mp4',
    status: 'COMPLETED_WITH_WARNING',
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    duration: '58:00',
    total_tasks: 12,
    completed_tasks: 11,
    failed_tasks: 1,
    summary_preview: 'Cơ chế Self-Attention và Transformer. Video không có tiếng, đã kích hoạt trích xuất OCR qua Rekognition.',
    s3_key: 'videos/usr-demo1/job-17c9e041/lecture.mp4'
  }
];

export const MOCK_JOB_DETAILS = {
  'job_7048e75d-0975-4e59-abd0-53d173441d38': {
    job_id: 'job_7048e75d-0975-4e59-abd0-53d173441d38',
    status: 'COMPLETED',
    original_filename: 'Transformers explained in under 3 minutes  Attention Is All You Need - Bidirectional AI (720p, h264).mp4',
    created_at: '2026-11-04T03:38:47.433Z',
    warnings: [],
    error_code: null,
    content_source: 'ASR',
    transcript: {
      schema_version: '1.0',
      job_id: 'job_7048e75d-0975-4e59-abd0-53d173441d38',
      source: 'ASR',
      text: "Almost every AI chatbot today grows out of one architecture from 2017. This is it, the transformer...",
      segments: [
        {
          start_time: 0.21,
          end_time: 5.1,
          text: 'Almost every AI chatbot today grows out of one architecture from 2017.',
          source: 'ASR'
        },
        {
          start_time: 5.42,
          end_time: 7.28,
          text: 'This is it, the transformer.',
          source: 'ASR'
        },
        {
          start_time: 7.6,
          end_time: 9.1,
          text: "Here's the problem it solved.",
          source: 'ASR'
        },
        {
          start_time: 9.36,
          end_time: 11.39,
          text: "What does the word it's point back to?",
          source: 'ASR'
        },
        {
          start_time: 11.7,
          end_time: 14.52,
          text: 'You find law seven words back at a glance.',
          source: 'ASR'
        },
        {
          start_time: 16.35,
          end_time: 21.79,
          text: 'Older networks read one word at a time, passing information through a chain of hidden states.',
          source: 'ASR'
        },
        {
          start_time: 22.23,
          end_time: 28.11,
          text: 'For law to influence its, that information must travel seven steps, each waiting for the one before.',
          source: 'ASR'
        },
        {
          start_time: 28.43,
          end_time: 32.51,
          text: 'That limits parallel training and makes long-range relationships harder to learn.',
          source: 'ASR'
        },
        {
          start_time: 33.97,
          end_time: 36.25,
          text: 'The transformer drops the weighting.',
          source: 'ASR'
        },
        {
          start_time: 36.57,
          end_time: 43.13,
          text: 'Its key idea is self-attention, which lets each word choose what to pay attention to instead of weighing everything equally.',
          source: 'ASR'
        },
        {
          start_time: 43.91,
          end_time: 46.66,
          text: 'Each word asks a question called a query.',
          source: 'ASR'
        },
        {
          start_time: 47.05,
          end_time: 50.87,
          text: 'Every word offers a key to match against and a value to hand over.',
          source: 'ASR'
        },
        {
          start_time: 51.31,
          end_time: 56.43,
          text: 'Score the query against each key, turn the scores into weights with a softmax, and mix the values.',
          source: 'ASR'
        },
        {
          start_time: 56.79,
          end_time: 58.79,
          text: 'Now its reaches law in a single step.',
          source: 'ASR'
        },
        {
          start_time: 60.16,
          end_time: 61.44,
          text: 'That is self-attention.',
          source: 'ASR'
        },
        {
          start_time: 62.74,
          end_time: 72.97,
          text: "One look is not enough because it's may need two words at once, so the model runs 8 attention heads side by side, each looking somewhere else.",
          source: 'ASR'
        },
        {
          start_time: 74.41,
          end_time: 75.81,
          text: 'But there is a catch.',
          source: 'ASR'
        },
        {
          start_time: 76.21,
          end_time: 78.05,
          text: 'Attention has no sense of order.',
          source: 'ASR'
        },
        {
          start_time: 79.02,
          end_time: 81.18,
          text: 'Shuffle the words and it sees the same thing.',
          source: 'ASR'
        },
        {
          start_time: 82.01,
          end_time: 87.41,
          text: 'So each word gets a wave added to it, a pattern of signs and cosines that marks its position.',
          source: 'ASR'
        },
        {
          start_time: 88.86,
          end_time: 89.63,
          text: 'Attention.',
          source: 'ASR'
        },
        {
          start_time: 90.08,
          end_time: 96.98,
          text: 'Then a small network on each word, each wrapped with a residual path and a normalization that is one layer.',
          source: 'ASR'
        },
        {
          start_time: 97.3,
          end_time: 99.58,
          text: 'Stack 6 of them and you have the encoder.',
          source: 'ASR'
        },
        {
          start_time: 100.55,
          end_time: 106.01,
          text: 'The other half, the decoder, is 6 layers too and writes the translation one word at a time.',
          source: 'ASR'
        },
        {
          start_time: 106.36,
          end_time: 110.52,
          text: 'It may not peek at words it has not written yet, so those are masked out.',
          source: 'ASR'
        },
        {
          start_time: 110.81,
          end_time: 116.25,
          text: 'It reads the English through attention too, then scores every word it knows and picks the likeliest.',
          source: 'ASR'
        },
        {
          start_time: 117.55,
          end_time: 124.07,
          text: 'In training, the whole translation is already known, so every word is learned in one parallel pass.',
          source: 'ASR'
        },
        {
          start_time: 124.39,
          end_time: 126.27,
          text: 'Only writing still goes word by word.',
          source: 'ASR'
        },
        {
          start_time: 127.53,
          end_time: 128.3,
          text: 'Did it work?',
          source: 'ASR'
        },
        {
          start_time: 128.58,
          end_time: 135.82,
          text: 'The big model trained for 3.5 days on 8 GPUs and beat every earlier English to German result by more than 2 points.',
          source: 'ASR'
        },
        {
          start_time: 138.01,
          end_time: 143.33,
          text: 'It also learned our opening jump linking its straight back to law.',
          source: 'ASR'
        },
        {
          start_time: 145.58,
          end_time: 147.19,
          text: 'So that is the big idea.',
          source: 'ASR'
        },
        {
          start_time: 147.66,
          end_time: 156.12,
          text: 'Before the transformer, recurrent networks read one word at a time, which made them slow to train, and their learning signal faded over long sentences.',
          source: 'ASR'
        },
        {
          start_time: 156.34,
          end_time: 157.95,
          text: 'The vanishing gradient problem.',
          source: 'ASR'
        },
        {
          start_time: 158.32,
          end_time: 162.3,
          text: 'Self-attention lets every word choose what to look at all at once.',
          source: 'ASR'
        },
        {
          start_time: 163.84,
          end_time: 169.26,
          text: 'GPT keeps the decoder, Bert keeps the encoder, and T5 keeps both.',
          source: 'ASR'
        },
        {
          start_time: 169.6,
          end_time: 173,
          text: 'The paper said attention is all you need, and it turned out to be right.',
          source: 'ASR'
        }
      ]
    },
    chunks: {
      schema_version: '1.0',
      job_id: 'job_7048e75d-0975-4e59-abd0-53d173441d38',
      chunks: [
        {
          chunk_id: 'chunk_1',
          start_time: 0.21,
          end_time: 173,
          text: 'Almost every AI chatbot today grows out of one architecture from 2017. This is it, the transformer...'
        }
      ]
    },
    summary:
      'Bài giảng giải thích chi tiết về kiến trúc Transformer (được giới thiệu năm 2017), nền tảng cốt lõi của các mô hình AI hiện đại. So với các mạng hồi quy (RNN) truyền thống xử lý từ theo thứ tự tuần tự gây chậm trễ trong huấn luyện song song và gặp vấn đề tiêu biến đạo hàm (vanishing gradient), Transformer sử dụng cơ chế Tự chú ý (Self-Attention) cho phép các từ kết nối trực tiếp với nhau chỉ trong một bước thông qua bộ ba Query, Key và Value. Mô hình sử dụng 8 đầu chú ý (Attention Heads) kết hợp với Mã hóa vị trí (Positional Encoding) bằng hàm sine/cosine để ghi nhận thứ tự từ. Kiến trúc chuẩn gồm 6 lớp Encoder và 6 lớp Decoder tích hợp đường nối còn lại (residual path) và chuẩn hóa lớp (layer normalization). Nhờ khả năng huấn luyện song song toàn bộ chuỗi dữ liệu, Transformer mang lại hiệu suất vượt trội và là cơ sở phát triển cho các mô hình như GPT (chỉ dùng Decoder), BERT (chỉ dùng Encoder) và T5 (dùng cả Encoder và Decoder).',
    quiz: {
      question: [
        {
          id: 1,
          difficulty: 'Easy',
          question: 'Hạn chế chính của các mạng thần kinh cũ (RNN) trước khi kiến trúc Transformer xuất hiện là gì?',
          option: {
            A: 'Không thể áp dụng hàm kích hoạt Softmax vào lớp đầu ra.',
            B: 'Đọc từng từ một theo thứ tự tuần tự, làm hạn chế huấn luyện song song và dễ bị tiêu biến đạo hàm.',
            C: 'Yêu cầu dữ liệu đầu vào phải được mã hóa dưới dạng hình ảnh.',
            D: 'Không thể xử lý được các câu có độ dài ngắn dưới 5 từ.'
          }
        },
        {
          id: 2,
          difficulty: 'Easy',
          question: 'Ba thành phần cốt lõi được mỗi từ sử dụng trong cơ chế Tự chú ý (Self-Attention) là gì?',
          option: {
            A: 'Query, Key và Value',
            B: 'Encoder, Decoder và Bottleneck',
            C: 'Input, Output và Hidden State',
            D: 'Weights, Biases và Activation'
          }
        },
        {
          id: 3,
          difficulty: 'Medium',
          question: 'Tại sao kiến trúc Transformer lại cần bổ sung Mã hóa vị trí (Positional Encoding) vào véc-tơ của mỗi từ?',
          option: {
            A: 'Để tăng kích thước mẫu dữ liệu giúp mô hình hội tụ nhanh hơn.',
            B: 'Để che đi các từ chưa được sinh ra trong quá trình Decoder dự đoán.',
            C: 'Vì bản thân cơ chế Attention không có khả năng tự nhận biết thứ tự hay vị trí của các từ trong câu.',
            D: 'Để thay thế hoàn toàn cho các đường nối còn lại (residual path).'
          }
        },
        {
          id: 4,
          difficulty: 'Medium',
          question: 'Sự khác biệt trong việc ứng dụng kiến trúc Transformer giữa các mô hình GPT, BERT và T5 là gì?',
          option: {
            A: 'GPT giữ cả Encoder và Decoder, BERT giữ Decoder, T5 giữ Encoder.',
            B: 'GPT chỉ giữ Encoder, BERT chỉ giữ Decoder, T5 giữ cả hai.',
            C: 'GPT chỉ giữ Decoder, BERT chỉ giữ Encoder, T5 giữ cả Encoder và Decoder.',
            D: 'Cả ba mô hình đều chỉ sử dụng phần Encoder.'
          }
        },
        {
          id: 5,
          difficulty: 'Hard',
          question: 'Tại sao trong quá trình huấn luyện bài toán dịch thuật, Transformer có thể học toàn bộ câu dịch trong một lượt song song (parallel pass)?',
          option: {
            A: 'Vì toàn bộ câu dịch mục tiêu đã được biết trước, còn các từ tương lai được che lại (masked out) ở Decoder.',
            B: 'Vì Decoder không cần thực hiện tính toán cơ chế Self-Attention khi huấn luyện.',
            C: 'Vì Encoder và Decoder hoạt động độc lập và không trao đổi thông tin với nhau.',
            D: 'Vì quá trình huấn luyện sử dụng hàm kích hoạt Sigmoid thay vì Softmax.'
          }
        },
        {
          id: 6,
          difficulty: 'Hard',
          question: 'Mỗi lớp (layer) tiêu chuẩn bên trong phần Encoder của Transformer được cấu tạo gồm những thành phần nào?',
          option: {
            A: 'Mạng cuộn (CNN) kết hợp với lớp đệm Dropout.',
            B: 'Cơ chế Self-Attention và mạng Feedforward, mỗi thành phần đều được bọc bởi đường nối còn lại (residual path) và chuẩn hóa lớp (layer normalization).',
            C: 'Masked Attention và Cross-Attention kết hợp với mạng Recurrent.',
            D: '8 đầu Attention xếp nối tiếp nhau cùng với hàm mã hóa Sine/Cosine.'
          }
        }
      ],
      answer: [
        {
          question_id: 1,
          correct_answer: 'B',
          explaination: 'Mạng RNN xử lý tuần tự từng từ một, khiến thời gian huấn luyện kéo dài và đạo hàm bị triệt tiêu khi câu quá dài.'
        },
        {
          question_id: 2,
          correct_answer: 'A',
          explaination: 'Trong Self-Attention, mỗi từ tạo ra một Query để tìm kiếm, Key để so khớp và Value để truyền thông tin.'
        },
        {
          question_id: 3,
          correct_answer: 'C',
          explaination: 'Self-Attention xử lý tất cả các từ song song và không phụ thuộc vào thứ tự, do đó cần Positional Encoding để định vị từ trong câu.'
        },
        {
          question_id: 4,
          correct_answer: 'C',
          explaination: 'GPT sử dụng kiến trúc Decoder-only, BERT sử dụng Encoder-only, còn T5 ứng dụng mô hình Encoder-Decoder hoàn chỉnh.'
        },
        {
          question_id: 5,
          correct_answer: 'A',
          explaination: 'Nhờ cơ chế Masked Attention, Decoder có thể nhận toàn bộ chuỗi đích cùng lúc trong huấn luyện mà không bị rò rỉ các từ ở tương lai.'
        },
        {
          question_id: 6,
          correct_answer: 'B',
          explaination: 'Mỗi lớp Encoder gồm một khối Self-Attention và Feedforward, đều được trang bị Residual Connection và Layer Normalization.'
        }
      ]
    },
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'
  },
  'job-98a4b12c': {
    job_id: 'job-98a4b12c',
    original_filename: 'CS101_Distributed_Systems_Lecture1.mp4',
    status: 'COMPLETED',
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    content_source: 'ASR',
    warnings: [],
    error_code: null,
    video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    transcript: {
      schema_version: '1.0',
      job_id: 'job-98a4b12c',
      source: 'ASR',
      text: 'Chào mừng các bạn đến với môn học Kiến trúc Hệ thống Phân tán và Điện toán Đám mây...',
      segments: [
        {
          start_time: 0,
          end_time: 14.5,
          text: 'Chào mừng các bạn đến với môn học Kiến trúc Hệ thống Phân tán và Điện toán Đám mây. Trong bài mở đầu hôm nay, chúng ta sẽ làm quen với khái niệm cốt lõi.',
          source: 'ASR'
        },
        {
          start_time: 15,
          end_time: 32.2,
          text: 'Một hệ thống phân tán bao gồm nhiều nút độc lập kết nối qua mạng máy tính, cùng phối hợp để giải quyết một bài toán tính toán quy mô lớn.',
          source: 'ASR'
        },
        {
          start_time: 33,
          end_time: 52.8,
          text: 'Định lý CAP (Consistency, Availability, Partition Tolerance) chỉ ra rằng một hệ thống phân tán chỉ có thể đảm bảo tối đa hai trong ba yếu tố cùng lúc.',
          source: 'ASR'
        },
        {
          start_time: 53.5,
          end_time: 75.0,
          text: 'Trong kiến trúc Cloud-native, việc phân tách stateless compute (như AWS Lambda) và state storage (như Amazon S3, DynamoDB) là nguyên tắc tối quan trọng.',
          source: 'ASR'
        },
        {
          start_time: 76.0,
          end_time: 98.4,
          text: 'Để xử lý các tác vụ nặng bất đồng bộ, chúng ta sử dụng Message Queue như Amazon SQS kết hợp Dead Letter Queue (DLQ) nhằm đảm bảo khả năng chịu lỗi fault-tolerance.',
          source: 'ASR'
        }
      ]
    },
    chunks: {
      schema_version: '1.0',
      job_id: 'job-98a4b12c',
      chunks: [
        {
          chunk_id: 'chunk_0001',
          start_time: 0,
          end_time: 98.4,
          text: 'Chào mừng các bạn đến với môn học Kiến trúc Hệ thống Phân tán và Điện toán Đám mây...'
        }
      ]
    },
    summary:
      'Bài giảng cung cấp kiến thức nền tảng về tính phân tán, định lý CAP và mô hình thiết kế Serverless-first trên nền tảng đám mây AWS. Hệ thống phân tán là tập hợp các node máy tính liên kết qua mạng truyền thông hướng đến tính mở rộng cao. Định lý CAP khẳng định khi có sự cố phân vùng mạng, hệ thống buộc phải đánh đổi giữa tính nhất quán và tính khả dụng. Kiến trúc Cloud-native ưu tiên tách biệt stateless compute như AWS Lambda và tầng lưu trữ dữ liệu như Amazon S3 và DynamoDB. Cuối cùng, mô hình hàng đợi Amazon SQS kết hợp Dead Letter Queue đảm bảo khả năng chịu lỗi và tự động thử lại khi tác vụ thất bại.',
    quiz: {
      question: [
        {
          id: 1,
          difficulty: 'Easy',
          question: 'Theo định lý CAP, khi xảy ra sự cố phân vùng mạng (Network Partition), hệ thống bắt buộc phải đánh đổi giữa 2 yếu tố nào?',
          option: {
            A: 'Consistency (Tính nhất quán) và Availability (Tính khả dụng)',
            B: 'Latency (Độ trễ) và Throughput (Băng thông)',
            C: 'Security (Bảo mật) và Scalability (Khả năng mở rộng)',
            D: 'Cost (Chi phí) và Memory (Bộ nhớ)'
          }
        },
        {
          id: 2,
          difficulty: 'Medium',
          question: 'Thành phần nào trong kiến trúc AWS giúp nhận thông điệp thất bại sau nhiều lần thử lại để ngăn ngừa nghẽn hàng đợi chính?',
          option: {
            A: 'Amazon CloudWatch Logs',
            B: 'Dead Letter Queue (DLQ)',
            C: 'Amazon Route 53',
            D: 'Amazon Cognito User Pool'
          }
        },
        {
          id: 3,
          difficulty: 'Hard',
          question: 'Tại sao S3 Presigned URL lại là lựa chọn tối ưu cho việc upload video trực tiếp từ trình duyệt web?',
          option: {
            A: 'Vì nó giúp mã hóa video bằng thuật toán lượng tử',
            B: 'Vì nó cho phép client upload thẳng lên S3 mà không cần đi qua backend, tiết kiệm băng thông và tài nguyên máy chủ',
            C: 'Vì nó cho phép upload không giới hạn dung lượng và không bao giờ hết hạn',
            D: 'Vì nó thay thế hoàn toàn hệ thống xác thực người dùng'
          }
        }
      ],
      answer: [
        {
          question_id: 1,
          correct_answer: 'A',
          explaination: 'Định lý CAP khẳng định khi có Partition (P), hệ thống chỉ có thể chọn CP hoặc AP.'
        },
        {
          question_id: 2,
          correct_answer: 'B',
          explaination: 'Dead Letter Queue (DLQ) là hàng đợi đặc biệt dùng để lưu giữ các message xử lý thất bại nhiều lần.'
        },
        {
          question_id: 3,
          correct_answer: 'B',
          explaination: 'Presigned URL cho phép client tương tác trực tiếp với S3 bucket an toàn trong thời gian có hạn.'
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
    transcript: {
      schema_version: '1.0',
      job_id: 'job-17c9e041',
      source: 'OCR',
      text: 'SLIDE 1: TRANSFORMERS ARCHITECTURE & SELF-ATTENTION MECHANISM...',
      segments: [
        {
          start_time: 0,
          end_time: 10,
          text: 'SLIDE 1: TRANSFORMERS ARCHITECTURE & SELF-ATTENTION MECHANISM\nGiới thiệu mô hình mạng nơ-ron Attention Is All You Need (Vaswani et al.)',
          source: 'OCR'
        },
        {
          start_time: 10,
          end_time: 25,
          text: 'SLIDE 2: SCALED DOT-PRODUCT ATTENTION FORMULA\nAttention(Q, K, V) = softmax(Q * K^T / sqrt(d_k)) * V\nTrong đó Q là Query, K là Key, V là Value.',
          source: 'OCR'
        },
        {
          start_time: 25,
          end_time: 45,
          text: 'SLIDE 3: MULTI-HEAD ATTENTION\nChia Q, K, V thành nhiều head chiếu không gian con, cho phép mô hình học các mối quan hệ ngữ nghĩa ở nhiều khía cạnh khác nhau.',
          source: 'OCR'
        }
      ]
    },
    chunks: {
      schema_version: '1.0',
      job_id: 'job-17c9e041',
      chunks: [
        {
          chunk_id: 'chunk_ocr_0001',
          start_time: 0,
          end_time: 45,
          text: 'SLIDE 1-3: TRANSFORMERS ARCHITECTURE & ATTENTION'
        }
      ]
    },
    summary:
      'Video không có âm thanh giọng nói. Hệ thống đã tự động kích hoạt pipeline OCR trích xuất văn bản từ khung hình video qua Amazon Rekognition. Cơ chế Attention thay thế mạng hồi quy RNN truyền thống và giải quyết triệt để vấn đề mất thông tin ngữ cảnh dài. Công thức Scaled Dot-Product sử dụng hệ số tỷ lệ căn bậc hai của d_k để tránh hiện tượng đạo hàm biến mất ở hàm Softmax. Multi-Head Attention mở rộng khả năng biểu diễn của mô hình bằng cách chiếu dữ liệu vào nhiều không gian vector độc lập.',
    quiz: {
      question: [
        {
          id: 1,
          difficulty: 'Easy',
          question: 'Ba thành phần đầu vào chính trong công thức Attention của Transformer là gì?',
          option: {
            A: 'Query (Q), Key (K), và Value (V)',
            B: 'Weights (W), Bias (B), và Activation (A)',
            C: 'Encoder, Decoder, và Bottleneck',
            D: 'Learning Rate, Epoch, và Batch Size'
          }
        }
      ],
      answer: [
        {
          question_id: 1,
          correct_answer: 'A',
          explaination: 'Cơ chế Self-Attention tính toán độ tương đồng giữa Query và Key để gán trọng số cho Value.'
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
