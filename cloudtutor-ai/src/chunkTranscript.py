import logging
from typing import Dict, Any, List

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def chunk_transcript(transcript_data: Dict[str, Any], max_chunk_duration: float = 300.0) -> Dict[str, Any]:
    logger.info("Bắt đầu tiến trình chia chunk transcript.")
    job_id = transcript_data.get("job_id", "")
    owner_id = transcript_data.get("owner_id", "")
    segments = transcript_data.get("segments", [])
    
    if owner_id and job_id:
        transcript_key = f"results/{owner_id}/{job_id}/chunk.json"
    else:
        transcript_key = "results/chunk.json"

    chunks: List[Dict[str, Any]] = []
    
    if not segments:
        logger.warning("Không tìm thấy segment nào trong dữ liệu transcript.")
        return {
            "schema_version": "1.0",
            "job_id": job_id,
            "owner_id": owner_id,
            "transcript_key": transcript_key,
            "processing_version": transcript_data.get("processing_version", "1"),
            "chunks": []
        }

    current_chunk_segments: List[Dict[str, Any]] = []
    chunk_start_time = segments[0].get("start_time", 0.0)
    chunk_counter = 1

    for segment in segments:
        start = segment.get("start_time", 0.0)
        end = segment.get("end_time", start)

        if current_chunk_segments and (start - chunk_start_time >= max_chunk_duration):
            chunk_text = " ".join([seg.get("text", "") for seg in current_chunk_segments])
            chunks.append({
                "chunk_id": f"chunk_{chunk_counter}",
                "start_time": chunk_start_time,
                "end_time": current_chunk_segments[-1].get("end_time", end),
                "text": chunk_text.strip()
            })
            chunk_counter += 1
            current_chunk_segments = [segment]
            chunk_start_time = start
        else:
            current_chunk_segments.append(segment)

    if current_chunk_segments:
        chunk_text = " ".join([seg.get("text", "") for seg in current_chunk_segments])
        chunks.append({
            "chunk_id": f"chunk_{chunk_counter}",
            "start_time": chunk_start_time,
            "end_time": current_chunk_segments[-1].get("end_time", chunk_start_time),
            "text": chunk_text.strip()
        })

    logger.info(f"Đã tạo thành công {len(chunks)} chunk.")
    
    return {
        "schema_version": "1.0",
        "job_id": job_id,
        "owner_id": owner_id,
        "transcript_key": transcript_key,
        "processing_version": transcript_data.get("processing_version", "1"),
        "chunks": chunks
    }
