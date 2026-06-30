import re

def extract_video_name(file_name: str) -> str | None:
    """
    Extract the video name from a frame filename.
    Matches the pattern: `<safe_video_name>_frame_<index>_<timestamp>ms.jpg`
    """
    if "_frame_" in file_name:
        return file_name.split("_frame_")[0]
    return None
