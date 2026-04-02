from dataclasses import dataclass
from typing import List, Optional, Callable


@dataclass
class ProcessData:
    command: str
    args: List[str]


ProcessCallback = Callable[[ProcessData], Optional[str]]
