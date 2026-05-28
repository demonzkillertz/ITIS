from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FrameExtractionConfig:
    sample_every_seconds: float = 1.0
    min_scene_change_score: float = 0.25
    min_motion_score: float = 0.08
    blur_threshold: float = 80.0
    duplicate_hash_threshold: int = 6


@dataclass(frozen=True)
class ExtractedFrame:
    path: Path
    timestamp_seconds: float
    motion_score: float
    scene_change_score: float
    blur_score: float


class FrameExtractor:
    def __init__(self, config: FrameExtractionConfig | None = None) -> None:
        self.config = config or FrameExtractionConfig()

    def extract(self, video_path: Path, output_dir: Path) -> list[ExtractedFrame]:
        """Extract diverse frames from a video.

        The implementation placeholder defines the service contract. The next
        milestone should connect OpenCV/FFmpeg here and apply the configured
        quality filters before returning stored frame metadata.
        """
        _ = (video_path, output_dir)
        return []
