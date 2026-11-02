import logging
from datetime import datetime, timezone

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def validate_and_update_job_status(job_id: str, chunk_result, summary_data, quiz_data, jobs_table, update_job_status_func):
    try:
        is_chunks_empty = not chunk_result
        is_summary_empty = not summary_data
        is_quiz_empty = not quiz_data

        if is_chunks_empty or is_summary_empty or is_quiz_empty:
            warning_reasons = []
            if is_chunks_empty:
                warning_reasons.append("chunks.json bị rỗng")
            if is_summary_empty:
                warning_reasons.append("summary.json bị rỗng")
            if is_quiz_empty:
                warning_reasons.append("quiz.json bị rỗng")
            
            warning_msg = ", ".join(warning_reasons)
            logger.warning("Job %s hoàn tất nhưng có cảnh báo: %s", job_id, warning_msg)
            
            # Cập nhật trạng thái COMPLETED_WITH_WARNING kèm warning_reason lên DynamoDB
            update_job_status_func(
                job_id, 
                "COMPLETED_WITH_WARNING", 
                {"warning_reason": warning_msg}
            )
            return False
        else:
            # Cập nhật trạng thái COMPLETED bình thường
            update_job_status_func(job_id, "COMPLETED")
            logger.info("Xử lý thành công toàn bộ nội dung học tập cho job_id: %s", job_id)
            return True

    except Exception as e:
        logger.exception("Lỗi khi thực hiện validate kết quả AI cho job %s: %s", job_id, str(e))
        raise
