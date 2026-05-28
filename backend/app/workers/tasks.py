from celery import Celery

from app.core.config import settings

celery_app = Celery("itis", broker=settings.redis_url, backend=settings.redis_url)


@celery_app.task(name="itis.extract_video_frames")
def extract_video_frames(video_path: str, output_dir: str) -> dict[str, int | str]:
    _ = (video_path, output_dir)
    return {"frames": 0, "status": "placeholder"}


@celery_app.task(name="itis.run_auto_annotation")
def run_auto_annotation(media_id: str, image_path: str) -> dict[str, int | str]:
    _ = (media_id, image_path)
    return {"detections": 0, "status": "placeholder"}
